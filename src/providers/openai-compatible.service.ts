import { HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CustomJsonMemory } from '../memory/custom-memory';
import {
  ModelStreamEvent,
  StreamAbortedError,
  StreamUsage,
} from '../types/llm-stream';
import { readSseData } from '../utils/sse';
import { BaseLlmService, CacheTokens } from './base-llm.service';
import { LlmResponse } from './llm-provider';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** The `usage` object of a completion, or of the last stream chunk. */
export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: RawUsage;
}

interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: RawUsage;
}

export interface ParsedUsage {
  usage: StreamUsage;
  cache: CacheTokens;
}

// Guards connection setup only: once tokens flow a long answer is healthy
const REQUEST_TIMEOUT_MS = 300000;

/**
 * A provider speaking the OpenAI chat completions protocol. Subclasses set
 * the endpoint, model and pricing, and override {@link parseUsage} when the
 * API reports more than prompt and completion tokens.
 */
export abstract class OpenAICompatibleService extends BaseLlmService {
  protected abstract readonly apiUrl: string;
  protected abstract readonly model: string;

  protected parseUsage(raw?: RawUsage): ParsedUsage {
    return {
      usage: {
        input_tokens: raw?.prompt_tokens ?? 0,
        output_tokens: raw?.completion_tokens ?? 0,
      },
      cache: {},
    };
  }

  private async buildMessages(
    memory: CustomJsonMemory,
    message: string,
    systemPrompt?: string,
  ): Promise<ChatMessage[]> {
    const { history } = await memory.loadMemoryVariables();
    const messages: ChatMessage[] = history.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    }));
    if (systemPrompt) {
      messages.unshift({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: message });
    return messages;
  }

  private async post(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: 'Unknown error' }));
      this.logger.error(
        `${this.displayName} API error response: ${JSON.stringify(errorData)}`,
      );
      throw new Error(
        `${this.displayName} API error: ${JSON.stringify(errorData)}`,
      );
    }
    return response;
  }

  private logRequest(
    requestId: string,
    sessionId: string,
    message: string,
    systemPrompt: string | undefined,
    historyLength: number,
  ): void {
    const truncate = (text: string) =>
      text.length > 1000
        ? `${text.substring(0, 100)}...${text.substring(text.length - 100)}`
        : text;

    this.logger.debug({
      message: `${this.displayName} API request [${requestId}]`,
      requestData: {
        session_id: sessionId,
        message: truncate(message),
        system_prompt: systemPrompt ? truncate(systemPrompt) : undefined,
        message_length: message.length,
        history_length: historyLength,
        system_prompt_length: systemPrompt?.length || 0,
        has_file: message.includes('Uploaded file ('),
        timestamp: new Date().toISOString(),
      },
    });
  }

  private toHttpException(
    error: unknown,
    action: 'process' | 'stream',
    requestId: string,
    sessionId: string,
  ): HttpException {
    this.logger.error({
      message: `Error ${action === 'process' ? 'processing' : 'streaming'} message with ${this.displayName} [${requestId}]`,
      error: error instanceof Error ? error.message : 'Unknown error',
      sessionId,
      timestamp: new Date().toISOString(),
    });

    if (error instanceof HttpException) {
      return error;
    }
    return new HttpException(
      `Failed to ${action} message with ${this.displayName}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  async processMessage(
    message: string,
    sessionId: string = randomUUID(),
    systemPrompt?: string,
  ): Promise<LlmResponse> {
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Processing message [${requestId}] for session [${sessionId}] with ${this.displayName}`,
    );
    this.requireApiKey();

    try {
      const messages = await this.buildMessages(memory, message, systemPrompt);
      this.logRequest(
        requestId,
        sessionId,
        message,
        systemPrompt,
        messages.length,
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      let response: Response;
      try {
        // No output ceiling. 4096 tokens silently truncated long answers,
        // such as a spreadsheet column rewritten row by row, mid-sentence.
        // Left unset so the limit is whatever the model allows rather than
        // a constant that has to be revisited on every model change.
        response = await this.post(
          { model: this.model, messages, temperature: 0.3 },
          controller.signal,
        );
      } finally {
        clearTimeout(timeoutId);
      }
      const responseData: ChatCompletion = await response.json();

      const content =
        responseData.choices?.[0]?.message?.content ||
        'No text content in response';

      // The system prompt stays out of the stored history
      await memory.saveContext({ input: message }, { response: content });

      const { usage, cache } = this.parseUsage(responseData.usage);
      const cost = this.calculateCost(
        usage.input_tokens,
        usage.output_tokens,
        this.pricing,
        cache,
      );

      this.logger.debug({
        message: `${this.displayName} API response [${requestId}]`,
        responseData: {
          response_length: content.length,
          model: this.model,
          ...usage,
          ...cost,
          timestamp: new Date().toISOString(),
        },
      });

      return { content, sessionId, usage, cost };
    } catch (error) {
      throw this.toHttpException(error, 'process', requestId, sessionId);
    }
  }

  /**
   * Streaming counterpart of {@link processMessage}: yields text deltas as
   * they arrive, then a terminal `final` event with the assembled answer,
   * usage and cost. History is saved once, at the end, exactly as the
   * non-streaming path does.
   */
  async *streamMessage(
    message: string,
    sessionId: string = randomUUID(),
    systemPrompt?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Streaming message [${requestId}] for session [${sessionId}] with ${this.displayName}`,
    );
    this.requireApiKey();

    try {
      const messages = await this.buildMessages(memory, message, systemPrompt);

      // `signal` stays live for the whole stream so an abandoned request
      // stops costing tokens
      if (signal?.aborted) {
        throw new StreamAbortedError();
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );
      signal?.addEventListener('abort', () => controller.abort(), {
        once: true,
      });

      let body: ReadableStream<Uint8Array>;
      try {
        const response = await this.post(
          {
            model: this.model,
            messages,
            temperature: 0.3,
            stream: true,
            // Without this the streamed response carries no usage at all,
            // which would leave cost tracking blind on every streamed request
            stream_options: { include_usage: true },
          },
          controller.signal,
        );
        if (!response.body) {
          throw new Error(
            `${this.displayName} API returned a streaming response with no body`,
          );
        }
        body = response.body;
      } finally {
        clearTimeout(timeoutId);
      }

      let parsed = this.parseUsage(undefined);
      let content = '';

      for await (const data of readSseData(body)) {
        if (!data || data === '[DONE]') continue;

        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          this.logger.warn(
            `Skipping unparseable ${this.displayName} stream payload`,
          );
          continue;
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          yield { type: 'text', text: delta };
        }

        // The usage-bearing chunk arrives last and has an empty choices array
        if (chunk.usage) {
          parsed = this.parseUsage(chunk.usage);
        }
      }

      const responseContent = content || 'No text content in response';

      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      const { usage, cache } = parsed;
      const cost = this.calculateCost(
        usage.input_tokens,
        usage.output_tokens,
        this.pricing,
        cache,
      );

      this.logger.debug({
        message: `${this.displayName} stream completed [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          model: this.model,
          ...usage,
          total_cost: cost.total_cost,
          timestamp: new Date().toISOString(),
        },
      });

      yield {
        type: 'final',
        content: responseContent,
        sessionId,
        usage,
        cost,
      };
    } catch (error) {
      if (error instanceof StreamAbortedError || signal?.aborted) {
        this.logger.log(
          `${this.displayName} stream [${requestId}] cancelled: client disconnected`,
        );
        return;
      }
      throw this.toHttpException(error, 'stream', requestId, sessionId);
    }
  }
}

import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CustomJsonMemory } from '../memory/custom-memory';
import { ModelStreamEvent, StreamAbortedError } from '../types/llm-stream';
import { readSseData } from '../utils/sse';

interface DeepSeekMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface DeepSeekResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

interface CostInfo {
  input_cost: number;
  output_cost: number;
  total_cost: number;
}

@Injectable()
export class DeepSeekService {
  private readonly apiKey: string;
  private readonly logger = new Logger(DeepSeekService.name);
  private readonly model: string = 'deepseek-v4-flash';
  private readonly apiUrl: string =
    'https://api.deepseek.com/v1/chat/completions';

  // Cost per 1K tokens in USD - DeepSeek Flash standard (peak) rates
  // verified 2026-09-11. `deepseek-v4-flash` is a legacy alias, still
  // accepted, routed to and billed at the current `deepseek-flash` price.
  // Input (cache miss): $0.30 per million tokens = $0.0003 per 1K tokens
  // Output: $1.20 per million tokens = $0.0012 per 1K tokens
  // Cache write: $0.30 per million tokens = $0.0003 per 1K tokens
  // Cache hit: $0.006 per million tokens = $0.000006 per 1K tokens
  private readonly COST_RATES = {
    inputCost: 0.0003,
    outputCost: 0.0012,
    cacheWriteCost: 0.0003,
    cacheReadCost: 0.000006,
  };

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!this.apiKey) {
      this.logger.warn(
        'DEEPSEEK_API_KEY environment variable is not set. DeepSeek service will be unavailable.',
      );
    } else {
      this.logger.log('DeepSeekService initialized successfully');
    }
  }

  async getConversationHistory(sessionId: string) {
    const memory = new CustomJsonMemory(sessionId);
    const { history } = await memory.loadMemoryVariables();
    return {
      history,
      isFirstMessage: history.length === 0,
    };
  }

  private calculateCost(
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens: number = 0,
    cacheReadTokens: number = 0,
  ): CostInfo {
    const regularInputTokens =
      inputTokens - cacheCreationTokens - cacheReadTokens;
    const inputCost = (regularInputTokens / 1000) * this.COST_RATES.inputCost;
    const cacheWriteCost =
      (cacheCreationTokens / 1000) * this.COST_RATES.cacheWriteCost;
    const cacheReadCost =
      (cacheReadTokens / 1000) * this.COST_RATES.cacheReadCost;
    const outputCost = (outputTokens / 1000) * this.COST_RATES.outputCost;
    const totalCost = inputCost + cacheWriteCost + cacheReadCost + outputCost;

    return {
      input_cost: Number(
        (inputCost + cacheWriteCost + cacheReadCost).toFixed(6),
      ),
      output_cost: Number(outputCost.toFixed(6)),
      total_cost: Number(totalCost.toFixed(6)),
    };
  }

  async processMessage(
    message: string,
    sessionId: string = randomUUID(),
    systemPrompt?: string,
  ): Promise<{
    content: string;
    sessionId: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    cost: CostInfo;
  }> {
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Processing message [${requestId}] for session [${sessionId}] with DeepSeek`,
    );

    if (!this.apiKey) {
      this.logger.error('DeepSeek API key is not configured');
      throw new HttpException(
        'DeepSeek service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const { history } = await memory.loadMemoryVariables();

      const formattedMessages: DeepSeekMessage[] = history.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));

      const containsUploadedFile = message.includes('Uploaded file (');

      this.logger.debug('Full message to be sent to DeepSeek:');
      this.logger.debug('----------------------------------------');
      this.logger.debug(`Request ID: ${requestId}`);
      this.logger.debug(`Session ID: ${sessionId}`);
      this.logger.debug(`Contains uploaded file: ${containsUploadedFile}`);
      this.logger.debug(`System prompt provided: ${!!systemPrompt}`);
      this.logger.debug('Message Content:');

      if (message.length > 1000) {
        this.logger.debug(
          `${message.substring(0, 100)}...${message.substring(message.length - 100)}`,
        );
      } else {
        this.logger.debug(message);
      }

      if (systemPrompt && systemPrompt.length > 1000) {
        this.logger.debug('System prompt: (truncated for log)');
        this.logger.debug(
          `${systemPrompt.substring(0, 100)}...${systemPrompt.substring(systemPrompt.length - 100)}`,
        );
      } else if (systemPrompt) {
        this.logger.debug(`System prompt: ${systemPrompt}`);
      }

      this.logger.debug('----------------------------------------');
      this.logger.debug(`Total message length: ${message.length} characters`);
      this.logger.debug(
        `System prompt length: ${systemPrompt?.length || 0} characters`,
      );
      this.logger.debug(
        `Chat history length: ${formattedMessages.length} messages`,
      );

      if (systemPrompt) {
        formattedMessages.unshift({
          role: 'system',
          content: systemPrompt,
        });
      }

      formattedMessages.push({
        role: 'user',
        content: message,
      });

      this.logger.debug({
        message: `DeepSeek API request [${requestId}]`,
        requestData: {
          message_length: message.length,
          history_length: formattedMessages.length,
          system_prompt_length: systemPrompt?.length || 0,
          has_file: containsUploadedFile,
          has_system_prompt: !!systemPrompt,
          timestamp: new Date().toISOString(),
        },
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      try {
        const requestBody = {
          model: this.model,
          messages: formattedMessages,
          temperature: 0.3,
        };

        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: 'Unknown error' }));
          this.logger.error(
            `DeepSeek API error response: ${JSON.stringify(errorData)}`,
          );
          throw new Error(`DeepSeek API error: ${JSON.stringify(errorData)}`);
        }

        const responseData: DeepSeekResponse = await response.json();

        const responseContent =
          responseData.choices[0]?.message?.content ||
          'No text content in response';

        await memory.saveContext(
          { input: message },
          { response: responseContent },
        );

        const usage = responseData.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        };

        const cacheHitTokens = usage.prompt_cache_hit_tokens || 0;
        const cacheMissTokens = usage.prompt_cache_miss_tokens || 0;

        const cost = this.calculateCost(
          usage.prompt_tokens,
          usage.completion_tokens,
          cacheMissTokens,
          cacheHitTokens,
        );

        this.logger.debug({
          message: `DeepSeek API response [${requestId}]`,
          responseData: {
            response_length: responseContent.length,
            model: this.model,
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            cache_hit_tokens: cacheHitTokens,
            cache_miss_tokens: cacheMissTokens,
            input_cost: cost.input_cost,
            output_cost: cost.output_cost,
            total_cost: cost.total_cost,
            timestamp: new Date().toISOString(),
          },
        });

        return {
          content: responseContent,
          sessionId,
          usage: {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            cache_creation_input_tokens: cacheMissTokens,
            cache_read_input_tokens: cacheHitTokens,
          },
          cost,
        };
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      this.logger.error({
        message: `Error processing message with DeepSeek [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to process message with DeepSeek',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      `Streaming message [${requestId}] for session [${sessionId}] with DeepSeek`,
    );

    if (!this.apiKey) {
      this.logger.error('DeepSeek API key is not configured');
      throw new HttpException(
        'DeepSeek service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const { history } = await memory.loadMemoryVariables();

      const formattedMessages: DeepSeekMessage[] = history.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));

      if (systemPrompt) {
        formattedMessages.unshift({
          role: 'system',
          content: systemPrompt,
        });
      }

      formattedMessages.push({
        role: 'user',
        content: message,
      });

      const requestBody = {
        model: this.model,
        messages: formattedMessages,
        temperature: 0.3,
        stream: true,
        // Without this the streamed response carries no usage at all, which
        // would leave cost tracking blind on every streamed request.
        stream_options: { include_usage: true },
      };

      if (signal?.aborted) {
        throw new StreamAbortedError();
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);
      signal?.addEventListener('abort', () => controller.abort(), {
        once: true,
      });

      let body: ReadableStream<Uint8Array>;
      try {
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: 'Unknown error' }));
          this.logger.error(
            `DeepSeek API error response: ${JSON.stringify(errorData)}`,
          );
          throw new Error(`DeepSeek API error: ${JSON.stringify(errorData)}`);
        }

        if (!response.body) {
          throw new Error(
            'DeepSeek API returned a streaming response with no body',
          );
        }

        body = response.body;
      } finally {
        clearTimeout(timeoutId);
      }

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheHitTokens = 0;
      let cacheMissTokens = 0;
      let content = '';

      for await (const data of readSseData(body)) {
        if (!data || data === '[DONE]') continue;

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          this.logger.warn('Skipping unparseable DeepSeek stream payload');
          continue;
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          yield { type: 'text', text: delta };
        }

        // The usage-bearing chunk arrives last and has an empty choices array
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
          cacheHitTokens = chunk.usage.prompt_cache_hit_tokens ?? 0;
          cacheMissTokens = chunk.usage.prompt_cache_miss_tokens ?? 0;
        }
      }

      const responseContent = content || 'No text content in response';

      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      const cost = this.calculateCost(
        inputTokens,
        outputTokens,
        cacheMissTokens,
        cacheHitTokens,
      );

      const usage = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheMissTokens,
        cache_read_input_tokens: cacheHitTokens,
      };

      this.logger.debug({
        message: `DeepSeek stream completed [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          model: this.model,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
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
          `DeepSeek stream [${requestId}] cancelled: client disconnected`,
        );
        return;
      }

      this.logger.error({
        message: `Error streaming message with DeepSeek [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to stream message with DeepSeek',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async deleteConversation(sessionId: string): Promise<boolean> {
    const memory = new CustomJsonMemory(sessionId);
    const { history } = await memory.loadMemoryVariables();
    if (history.length > 0) {
      await memory.saveContext({ input: '' }, { response: '' });
      return true;
    }
    return false;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

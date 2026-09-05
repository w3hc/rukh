import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CustomJsonMemory } from '../memory/custom-memory';
import { ModelStreamEvent, StreamAbortedError } from '../types/llm-stream';
import { readSseData } from '../utils/sse';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  // A string for plain turns; an array of content blocks when replaying
  // assistant turns that contain server tool use (web search)
  content: string | Array<Record<string, unknown>>;
}

interface AnthropicResponse {
  id: string;
  content: Array<{
    type: string;
    text?: string;
  }>;
  model: string;
  role: string;
  stop_reason?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    server_tool_use?: {
      web_search_requests?: number;
    };
  };
}

interface CostInfo {
  input_cost: number;
  output_cost: number;
  total_cost: number;
  web_search_cost?: number;
}

@Injectable()
export class AnthropicService {
  private readonly apiKey: string;
  private readonly logger = new Logger(AnthropicService.name);
  private readonly model: string = 'claude-sonnet-5';
  private readonly apiUrl: string = 'https://api.anthropic.com/v1/messages';
  private readonly apiVersion: string = '2023-06-01';

  // Cost per 1K tokens in USD - Claude Sonnet 5 rates
  // https://platform.claude.com/docs/en/about-claude/pricing (verified 2026-08-31)
  private readonly COST_RATES = {
    inputCost: 0.002, // $2 per million tokens = $0.002 per 1K tokens
    outputCost: 0.01, // $10 per million tokens = $0.01 per 1K tokens
  };

  // Web search server tool: $10 per 1,000 searches, on top of token costs
  private readonly WEB_SEARCH_COST_PER_REQUEST = 0.01;
  private readonly WEB_SEARCH_MAX_USES = 8;
  private readonly WEB_FETCH_MAX_USES = 8;
  // Long server-tool turns may pause; cap the continuation loop defensively
  private readonly MAX_CONTINUATIONS = 5;
  // Optional ANTHROPIC_EFFORT override; unset means the API's own default
  private readonly EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
  private readonly effort?: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!this.apiKey) {
      this.logger.error('ANTHROPIC_API_KEY environment variable is not set');
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    const effort = this.configService.get<string>('ANTHROPIC_EFFORT');
    if (effort && !this.EFFORT_LEVELS.includes(effort)) {
      this.logger.warn(
        `Ignoring ANTHROPIC_EFFORT='${effort}': expected one of ${this.EFFORT_LEVELS.join(', ')}`,
      );
      this.effort = undefined;
    } else {
      this.effort = effort || undefined;
    }

    this.logger.log(
      `AnthropicService initialized successfully (effort: ${this.effort ?? 'default'})`,
    );
  }

  /**
   * Reasoning configuration for the streaming paths.
   *
   * Thinking is on by default on this model, and its default `display` is
   * `omitted` - the blocks stream with empty text. That reads as a dead
   * connection for however long the model reasons, which on a long rewrite is
   * minutes, so ask for the summary and forward it. Effort is the lever that
   * decides how much of the token budget goes to reasoning at all; left unset
   * the API applies its own default.
   */
  private reasoningFields(): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      thinking: { type: 'adaptive', display: 'summarized' },
    };
    if (this.effort) {
      fields.output_config = { effort: this.effort };
    }
    return fields;
  }

  async getConversationHistory(sessionId: string) {
    const memory = new CustomJsonMemory(sessionId);
    const { history } = await memory.loadMemoryVariables();
    return {
      history,
      isFirstMessage: history.length === 0,
    };
  }

  private calculateCost(inputTokens: number, outputTokens: number): CostInfo {
    const inputCost = Number(
      ((inputTokens / 1000) * this.COST_RATES.inputCost).toFixed(6),
    );
    const outputCost = Number(
      ((outputTokens / 1000) * this.COST_RATES.outputCost).toFixed(6),
    );
    const totalCost = Number((inputCost + outputCost).toFixed(6));

    return {
      input_cost: inputCost,
      output_cost: outputCost,
      total_cost: totalCost,
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
    };
    cost: CostInfo;
  }> {
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Processing message [${requestId}] for session [${sessionId}] with Anthropic`,
    );

    try {
      const { history } = await memory.loadMemoryVariables();

      const formattedMessages: AnthropicMessage[] = history.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));

      const containsUploadedFile = message.includes('Uploaded file (');

      this.logger.debug('Full message to be sent to Anthropic:');
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

      formattedMessages.push({
        role: 'user',
        content: message,
      });

      this.logger.debug({
        message: `Anthropic API request [${requestId}]`,
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
        // Build request body with system prompt as a top-level parameter (not as a message)
        const requestBody: any = {
          model: this.model,
          max_tokens: 64000,
          messages: formattedMessages,
        };

        // Add system as a top-level parameter if provided
        if (systemPrompt) {
          requestBody.system = systemPrompt;
        }

        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': this.apiVersion,
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
            `Anthropic API error response: ${JSON.stringify(errorData)}`,
          );
          throw new Error(`Anthropic API error: ${JSON.stringify(errorData)}`);
        }

        const responseData: AnthropicResponse = await response.json();

        const responseContent =
          responseData.content
            .filter((block) => block.type === 'text' && block.text)
            .map((block) => block.text)
            .join('') || 'No text content in response';

        // Save only the user message and response to the conversation history
        // We don't want to save the system prompt in the conversation history
        await memory.saveContext(
          { input: message },
          { response: responseContent },
        );

        const usage = responseData.usage || {
          input_tokens: 0,
          output_tokens: 0,
        };

        // Calculate cost based on actual token usage
        const cost = this.calculateCost(
          usage.input_tokens,
          usage.output_tokens,
        );

        this.logger.debug({
          message: `Anthropic API response [${requestId}]`,
          responseData: {
            response_length: responseContent.length,
            model: this.model,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            input_cost: cost.input_cost,
            output_cost: cost.output_cost,
            total_cost: cost.total_cost,
            timestamp: new Date().toISOString(),
          },
        });

        return {
          content: responseContent,
          sessionId,
          usage,
          cost,
        };
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      this.logger.error({
        message: `Error processing message with Anthropic [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to process message with Anthropic',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Process a message with the Anthropic server-side web search tool enabled.
   * The whole search loop runs on Anthropic's infrastructure; the only
   * orchestration needed here is a continuation loop on the `pause_turn`
   * stop reason. Usage and cost are summed across all continuation calls,
   * including the per-search fee.
   */
  async processMessageWithWebSearch(
    message: string,
    sessionId: string = randomUUID(),
    systemPrompt?: string,
  ): Promise<{
    content: string;
    sessionId: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
    cost: CostInfo;
  }> {
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Processing message [${requestId}] for session [${sessionId}] with Anthropic (web search enabled)`,
    );

    try {
      const { history } = await memory.loadMemoryVariables();

      let messages: AnthropicMessage[] = history.map((msg) => ({
        role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));

      messages.push({
        role: 'user',
        content: message,
      });

      const tools = [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: this.WEB_SEARCH_MAX_USES,
        },
        {
          type: 'web_fetch_20260209',
          name: 'web_fetch',
          max_uses: this.WEB_FETCH_MAX_USES,
        },
      ];

      const totalUsage = { input_tokens: 0, output_tokens: 0 };
      let totalSearches = 0;

      const callApi = async (
        currentMessages: AnthropicMessage[],
      ): Promise<AnthropicResponse> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000);

        try {
          const requestBody: any = {
            model: this.model,
            max_tokens: 64000,
            messages: currentMessages,
            tools,
          };

          if (systemPrompt) {
            requestBody.system = systemPrompt;
          }

          const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.apiKey,
              'anthropic-version': this.apiVersion,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorData = await response
              .json()
              .catch(() => ({ error: 'Unknown error' }));
            this.logger.error(
              `Anthropic API error response: ${JSON.stringify(errorData)}`,
            );
            throw new Error(
              `Anthropic API error: ${JSON.stringify(errorData)}`,
            );
          }

          return (await response.json()) as AnthropicResponse;
        } finally {
          clearTimeout(timeoutId);
        }
      };

      const accumulateUsage = (responseData: AnthropicResponse) => {
        const usage = responseData.usage || {
          input_tokens: 0,
          output_tokens: 0,
        };
        totalUsage.input_tokens += usage.input_tokens || 0;
        totalUsage.output_tokens += usage.output_tokens || 0;
        totalSearches += usage.server_tool_use?.web_search_requests || 0;
      };

      let responseData = await callApi(messages);
      accumulateUsage(responseData);

      let hops = 0;
      while (
        responseData.stop_reason === 'pause_turn' &&
        hops++ < this.MAX_CONTINUATIONS
      ) {
        this.logger.log(
          `Continuing paused turn [${requestId}] (continuation ${hops}/${this.MAX_CONTINUATIONS})`,
        );
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: responseData.content as Array<Record<string, unknown>>,
          },
        ];
        responseData = await callApi(messages);
        accumulateUsage(responseData);
      }

      // The content array interleaves server_tool_use and search result
      // blocks with text. Keep only the last contiguous run of text blocks:
      // earlier runs are pre-search preamble ("let me search for that...").
      // Within a run, blocks are joined without separator because citations
      // split text mid-sentence into adjacent blocks.
      let lastSegment = '';
      let currentSegment = '';
      for (const block of responseData.content) {
        if (block.type === 'text' && block.text) {
          currentSegment += block.text;
        } else if (currentSegment) {
          lastSegment = currentSegment;
          currentSegment = '';
        }
      }
      if (currentSegment) {
        lastSegment = currentSegment;
      }
      const responseContent = lastSegment || 'No text content in response';

      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      const cost = this.calculateCost(
        totalUsage.input_tokens,
        totalUsage.output_tokens,
      );
      const webSearchCost = Number(
        (totalSearches * this.WEB_SEARCH_COST_PER_REQUEST).toFixed(6),
      );
      cost.web_search_cost = webSearchCost;
      cost.total_cost = Number((cost.total_cost + webSearchCost).toFixed(6));

      this.logger.debug({
        message: `Anthropic web search response [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          model: this.model,
          web_searches: totalSearches,
          continuations: hops,
          input_tokens: totalUsage.input_tokens,
          output_tokens: totalUsage.output_tokens,
          total_cost: cost.total_cost,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        content: responseContent,
        sessionId,
        usage: totalUsage,
        cost,
      };
    } catch (error) {
      this.logger.error({
        message: `Error processing message with Anthropic web search [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to process message with Anthropic web search',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Opens a streaming request to the Messages API and hands back the raw SSE
   * body.
   *
   * The timeout only guards connection setup: once the first bytes arrive the
   * answer may legitimately take minutes to finish, so it is cleared rather
   * than cutting a healthy stream short. The controller itself outlives the
   * timeout - `signal` is how a caller cancels a stream that is still healthy
   * but no longer wanted, which is what stops the token meter when the client
   * has hung up.
   */
  private async openStream(
    requestBody: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    if (signal?.aborted) {
      throw new StreamAbortedError();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.apiVersion,
        },
        body: JSON.stringify({ ...requestBody, stream: true }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: 'Unknown error' }));
        this.logger.error(
          `Anthropic API error response: ${JSON.stringify(errorData)}`,
        );
        throw new Error(`Anthropic API error: ${JSON.stringify(errorData)}`);
      }

      if (!response.body) {
        throw new Error(
          'Anthropic API returned a streaming response with no body',
        );
      }

      return response.body;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Parses one SSE payload, tolerating the keep-alive lines the API sends. */
  private parseStreamEvent(data: string): any | null {
    if (!data || data === '[DONE]') {
      return null;
    }
    try {
      return JSON.parse(data);
    } catch {
      this.logger.warn(`Skipping unparseable Anthropic stream payload`);
      return null;
    }
  }

  /**
   * Streaming counterpart of {@link processMessage}: yields text deltas as
   * they arrive, then a terminal `final` event carrying the assembled answer
   * with usage and cost. History is saved once, at the end, exactly as the
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
      `Streaming message [${requestId}] for session [${sessionId}] with Anthropic`,
    );

    try {
      const { history } = await memory.loadMemoryVariables();

      const formattedMessages: AnthropicMessage[] = history.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));

      formattedMessages.push({
        role: 'user',
        content: message,
      });

      const requestBody: Record<string, unknown> = {
        model: this.model,
        // Thinking shares this budget with the answer, and on Sonnet 5
        // thinking is on by default. A 182-row rewrite was already spending
        // 56k of a 64k ceiling, most of it invisible, so the next slightly
        // longer input would have been truncated mid-answer. 128k is the
        // model's maximum and is only allowed because this path streams.
        max_tokens: 128000,
        messages: formattedMessages,
        ...this.reasoningFields(),
      };

      if (systemPrompt) {
        requestBody.system = systemPrompt;
      }

      const body = await this.openStream(requestBody, 300000, signal);

      const usage = { input_tokens: 0, output_tokens: 0 };
      let content = '';

      for await (const data of readSseData(body)) {
        const event = this.parseStreamEvent(data);
        if (!event) continue;

        switch (event.type) {
          case 'message_start':
            usage.input_tokens = event.message?.usage?.input_tokens ?? 0;
            break;
          case 'content_block_delta':
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              content += event.delta.text;
              yield { type: 'text', text: event.delta.text };
            } else if (
              event.delta?.type === 'thinking_delta' &&
              event.delta.thinking
            ) {
              // Reasoning, not answer: forwarded for the client to render as
              // it likes, and deliberately kept out of `content`
              yield { type: 'thinking', text: event.delta.thinking };
            }
            break;
          case 'message_delta':
            // Output tokens are only final on this event; earlier events
            // report the running count for the current block.
            usage.output_tokens =
              event.usage?.output_tokens ?? usage.output_tokens;
            break;
          case 'error':
            throw new Error(
              `Anthropic API stream error: ${JSON.stringify(event.error)}`,
            );
        }
      }

      const responseContent = content || 'No text content in response';

      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      const cost = this.calculateCost(usage.input_tokens, usage.output_tokens);

      this.logger.debug({
        message: `Anthropic stream completed [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          model: this.model,
          effort: this.effort ?? 'default',
          input_tokens: usage.input_tokens,
          // Reasoning is billed as output but never reaches the client, so
          // `output_tokens` far above what `response_length` accounts for is
          // reasoning spend - that gap is what an effort change moves
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
      if (this.wasAborted(error, signal)) {
        // Nobody is listening any more - end the generator quietly, and leave
        // the partial answer out of history
        this.logger.log(
          `Anthropic stream [${requestId}] cancelled: client disconnected`,
        );
        return;
      }

      this.logger.error({
        message: `Error streaming message with Anthropic [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to stream message with Anthropic',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Whether a failed stream was cancelled by us rather than genuinely broken.
   *
   * `fetch` reports a cancelled request as a generic `AbortError`, which is
   * indistinguishable from the setup timeout firing - so the caller's signal
   * is what actually decides, and the sentinel covers the case where we never
   * got as far as issuing the request.
   */
  private wasAborted(error: unknown, signal?: AbortSignal): boolean {
    if (error instanceof StreamAbortedError) {
      return true;
    }
    return Boolean(signal?.aborted);
  }

  /**
   * Reads a single streamed API call, yielding text deltas and rebuilding the
   * response's content blocks into `turn`.
   *
   * The blocks have to be reassembled because a paused turn can only be
   * continued by replaying the assistant message verbatim, tool-use blocks
   * included - the same replay the non-streaming path does with the JSON
   * response body.
   */
  private async *streamWebSearchTurn(
    requestBody: Record<string, unknown>,
    turn: {
      blocks: Array<Record<string, any>>;
      stopReason?: string;
      usage: { input_tokens: number; output_tokens: number };
      searches: number;
      streamedSegment: string;
    },
    signal?: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    const body = await this.openStream(requestBody, 600000, signal);

    // Accumulated `input_json_delta` fragments, keyed by content block index
    const partialJson = new Map<number, string>();
    turn.blocks = [];
    turn.stopReason = undefined;

    for await (const data of readSseData(body)) {
      const event = this.parseStreamEvent(data);
      if (!event) continue;

      switch (event.type) {
        case 'message_start':
          turn.usage.input_tokens += event.message?.usage?.input_tokens ?? 0;
          break;

        case 'content_block_start': {
          const block = { ...(event.content_block ?? {}) };
          turn.blocks[event.index] = block;
          if (
            block.type !== 'text' &&
            block.type !== 'thinking' &&
            turn.streamedSegment
          ) {
            // A tool call interrupts the answer: what came before it was
            // preamble, so tell the client to drop it.
            turn.streamedSegment = '';
            yield { type: 'reset' };
          }
          break;
        }

        case 'content_block_delta': {
          const block = turn.blocks[event.index];
          if (!block) break;

          if (event.delta?.type === 'text_delta' && event.delta.text) {
            block.text = (block.text ?? '') + event.delta.text;
            turn.streamedSegment += event.delta.text;
            yield { type: 'text', text: event.delta.text };
          } else if (
            event.delta?.type === 'thinking_delta' &&
            event.delta.thinking
          ) {
            // Accumulated onto the block as well as forwarded: a paused turn
            // is continued by replaying the assistant message verbatim, and a
            // thinking block replayed without its text is rejected
            block.thinking = (block.thinking ?? '') + event.delta.thinking;
            yield { type: 'thinking', text: event.delta.thinking };
          } else if (event.delta?.type === 'signature_delta') {
            // The signature authenticates the replayed thinking block
            block.signature = (block.signature ?? '') + event.delta.signature;
          } else if (event.delta?.type === 'input_json_delta') {
            partialJson.set(
              event.index,
              (partialJson.get(event.index) ?? '') +
                (event.delta.partial_json ?? ''),
            );
          } else if (event.delta?.type === 'citations_delta') {
            block.citations = [
              ...(block.citations ?? []),
              event.delta.citation,
            ];
          }
          break;
        }

        case 'content_block_stop': {
          const json = partialJson.get(event.index);
          if (json !== undefined && turn.blocks[event.index]) {
            try {
              turn.blocks[event.index].input = JSON.parse(json || '{}');
            } catch {
              this.logger.warn(
                `Unparseable tool input JSON on block ${event.index}`,
              );
              turn.blocks[event.index].input = {};
            }
            partialJson.delete(event.index);
          }
          break;
        }

        case 'message_delta':
          turn.usage.output_tokens += event.usage?.output_tokens ?? 0;
          turn.searches +=
            event.usage?.server_tool_use?.web_search_requests ?? 0;
          turn.stopReason = event.delta?.stop_reason ?? turn.stopReason;
          break;

        case 'error':
          throw new Error(
            `Anthropic API stream error: ${JSON.stringify(event.error)}`,
          );
      }
    }

    // Blocks arrive indexed, and a dropped index would leave a hole that
    // breaks the replay, so compact before handing the array back.
    turn.blocks = turn.blocks.filter(Boolean);
  }

  /**
   * Streaming counterpart of {@link processMessageWithWebSearch}.
   *
   * Text is emitted as it arrives so the caller sees progress during a long
   * search, and a `reset` event marks the point where narration gives way to
   * the real answer - keeping the streamed text in step with the `content` of
   * the final event, which applies the same last-text-segment rule as the
   * non-streaming path.
   */
  async *streamMessageWithWebSearch(
    message: string,
    sessionId: string = randomUUID(),
    systemPrompt?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Streaming message [${requestId}] for session [${sessionId}] with Anthropic (web search enabled)`,
    );

    try {
      const { history } = await memory.loadMemoryVariables();

      let messages: AnthropicMessage[] = history.map((msg) => ({
        role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));

      messages.push({
        role: 'user',
        content: message,
      });

      const tools = [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: this.WEB_SEARCH_MAX_USES,
        },
        {
          type: 'web_fetch_20260209',
          name: 'web_fetch',
          max_uses: this.WEB_FETCH_MAX_USES,
        },
      ];

      const buildBody = (currentMessages: AnthropicMessage[]) => {
        const requestBody: Record<string, unknown> = {
          model: this.model,
          // 128k for the same reason as the plain streaming path above.
          max_tokens: 128000,
          messages: currentMessages,
          tools,
          ...this.reasoningFields(),
        };
        if (systemPrompt) {
          requestBody.system = systemPrompt;
        }
        return requestBody;
      };

      const turn = {
        blocks: [] as Array<Record<string, any>>,
        stopReason: undefined as string | undefined,
        usage: { input_tokens: 0, output_tokens: 0 },
        searches: 0,
        streamedSegment: '',
      };

      yield* this.streamWebSearchTurn(buildBody(messages), turn, signal);

      let hops = 0;
      while (
        turn.stopReason === 'pause_turn' &&
        hops++ < this.MAX_CONTINUATIONS
      ) {
        this.logger.log(
          `Continuing paused turn [${requestId}] (continuation ${hops}/${this.MAX_CONTINUATIONS})`,
        );

        // Only the final continuation's text counts as the answer, so drop
        // whatever the paused turn had already streamed.
        if (turn.streamedSegment) {
          turn.streamedSegment = '';
          yield { type: 'reset' };
        }

        messages = [
          ...messages,
          {
            role: 'assistant',
            content: turn.blocks as Array<Record<string, unknown>>,
          },
        ];

        yield* this.streamWebSearchTurn(buildBody(messages), turn, signal);
      }

      // Keep only the last contiguous run of text blocks: earlier runs are
      // pre-search preamble. Within a run, blocks are joined without
      // separator because citations split text mid-sentence.
      let lastSegment = '';
      let currentSegment = '';
      for (const block of turn.blocks) {
        if (block.type === 'text' && block.text) {
          currentSegment += block.text;
        } else if (block.type === 'thinking') {
          // Thinking does not end a run - it is not preamble, it is reasoning
          // that happens to sit between text blocks. This has to agree with
          // the `reset` rule above or the streamed text and `content` diverge.
          continue;
        } else if (currentSegment) {
          lastSegment = currentSegment;
          currentSegment = '';
        }
      }
      if (currentSegment) {
        lastSegment = currentSegment;
      }
      const responseContent = lastSegment || 'No text content in response';

      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      const cost = this.calculateCost(
        turn.usage.input_tokens,
        turn.usage.output_tokens,
      );
      const webSearchCost = Number(
        (turn.searches * this.WEB_SEARCH_COST_PER_REQUEST).toFixed(6),
      );
      cost.web_search_cost = webSearchCost;
      cost.total_cost = Number((cost.total_cost + webSearchCost).toFixed(6));

      this.logger.debug({
        message: `Anthropic web search stream completed [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          model: this.model,
          web_searches: turn.searches,
          continuations: hops,
          input_tokens: turn.usage.input_tokens,
          output_tokens: turn.usage.output_tokens,
          total_cost: cost.total_cost,
          timestamp: new Date().toISOString(),
        },
      });

      yield {
        type: 'final',
        content: responseContent,
        sessionId,
        usage: turn.usage,
        cost,
      };
    } catch (error) {
      if (this.wasAborted(error, signal)) {
        this.logger.log(
          `Anthropic web search stream [${requestId}] cancelled: client disconnected`,
        );
        return;
      }

      this.logger.error({
        message: `Error streaming message with Anthropic web search [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to stream message with Anthropic web search',
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
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

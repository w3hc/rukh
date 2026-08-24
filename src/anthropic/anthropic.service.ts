import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CustomJsonMemory } from '../memory/custom-memory';

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
  private readonly COST_RATES = {
    inputCost: 0.003, // $3 per million tokens = $0.003 per 1K tokens
    outputCost: 0.015, // $15 per million tokens = $0.015 per 1K tokens
  };

  // Web search server tool: $10 per 1,000 searches, on top of token costs
  private readonly WEB_SEARCH_COST_PER_REQUEST = 0.01;
  private readonly WEB_SEARCH_MAX_USES = 8;
  // Long server-tool turns may pause; cap the continuation loop defensively
  private readonly MAX_CONTINUATIONS = 5;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!this.apiKey) {
      this.logger.error('ANTHROPIC_API_KEY environment variable is not set');
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    this.logger.log('AnthropicService initialized successfully');
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
          responseData.content[0]?.text || 'No text content in response';

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
      ];

      const totalUsage = { input_tokens: 0, output_tokens: 0 };
      let totalSearches = 0;

      const callApi = async (
        currentMessages: AnthropicMessage[],
      ): Promise<AnthropicResponse> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000);

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

import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CustomJsonMemory } from '../memory/custom-memory';
import { ModelStreamEvent } from '../types/llm-stream';
import { readSseData } from '../utils/sse';

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

interface CostInfo {
  input_cost: number;
  output_cost: number;
  total_cost: number;
}

@Injectable()
export class OpenAIService {
  private readonly apiKey: string;
  private readonly logger = new Logger(OpenAIService.name);
  private readonly model: string = 'gpt-4o';
  private readonly apiUrl: string =
    'https://api.openai.com/v1/chat/completions';

  // Cost per 1K tokens in USD - GPT-4o rates
  // https://developers.openai.com/api/docs/pricing (verified 2026-08-31)
  private readonly COST_RATES = {
    inputCost: 0.0025, // $2.50 per million tokens = $0.0025 per 1K tokens
    outputCost: 0.01, // $10 per million tokens = $0.01 per 1K tokens
  };

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!this.apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY environment variable is not set. OpenAI service will be unavailable.',
      );
    } else {
      this.logger.log('OpenAIService initialized successfully');
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
      `Processing message [${requestId}] for session [${sessionId}] with OpenAI`,
    );

    // Check if API key is available
    if (!this.apiKey) {
      this.logger.error('OpenAI API key is not configured');
      throw new HttpException(
        'OpenAI service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const { history } = await memory.loadMemoryVariables();

      const formattedMessages: OpenAIMessage[] = history.map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));

      const containsUploadedFile = message.includes('Uploaded file (');

      this.logger.debug('Full message to be sent to OpenAI:');
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

      // Add system prompt as a system message at the beginning if provided
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
        message: `OpenAI API request [${requestId}]`,
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
          max_tokens: 4096,
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
            `OpenAI API error response: ${JSON.stringify(errorData)}`,
          );
          throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
        }

        const responseData: OpenAIResponse = await response.json();

        const responseContent =
          responseData.choices[0]?.message?.content ||
          'No text content in response';

        // Save only the user message and response to the conversation history
        // We don't want to save the system prompt in the conversation history
        await memory.saveContext(
          { input: message },
          { response: responseContent },
        );

        const usage = {
          input_tokens: responseData.usage?.prompt_tokens || 0,
          output_tokens: responseData.usage?.completion_tokens || 0,
        };

        // Calculate cost based on actual token usage
        const cost = this.calculateCost(
          usage.input_tokens,
          usage.output_tokens,
        );

        this.logger.debug({
          message: `OpenAI API response [${requestId}]`,
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
        message: `Error processing message with OpenAI [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to process message with OpenAI',
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
  ): AsyncGenerator<ModelStreamEvent> {
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Streaming message [${requestId}] for session [${sessionId}] with OpenAI`,
    );

    if (!this.apiKey) {
      this.logger.error('OpenAI API key is not configured');
      throw new HttpException(
        'OpenAI service unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const { history } = await memory.loadMemoryVariables();

      const formattedMessages: OpenAIMessage[] = history.map((msg) => ({
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
        max_tokens: 4096,
        stream: true,
        // Without this the streamed response carries no usage at all, which
        // would leave cost tracking blind on every streamed request.
        stream_options: { include_usage: true },
      };

      // The timeout only guards connection setup: once tokens are flowing a
      // long answer is healthy, not stalled.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

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
            `OpenAI API error response: ${JSON.stringify(errorData)}`,
          );
          throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
        }

        if (!response.body) {
          throw new Error(
            'OpenAI API returned a streaming response with no body',
          );
        }

        body = response.body;
      } finally {
        clearTimeout(timeoutId);
      }

      const usage = { input_tokens: 0, output_tokens: 0 };
      let content = '';

      for await (const data of readSseData(body)) {
        if (!data || data === '[DONE]') continue;

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          this.logger.warn('Skipping unparseable OpenAI stream payload');
          continue;
        }

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          yield { type: 'text', text: delta };
        }

        // The usage-bearing chunk arrives last and has an empty choices array
        if (chunk.usage) {
          usage.input_tokens = chunk.usage.prompt_tokens ?? 0;
          usage.output_tokens = chunk.usage.completion_tokens ?? 0;
        }
      }

      const responseContent = content || 'No text content in response';

      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      const cost = this.calculateCost(usage.input_tokens, usage.output_tokens);

      this.logger.debug({
        message: `OpenAI stream completed [${requestId}]`,
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
      this.logger.error({
        message: `Error streaming message with OpenAI [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to stream message with OpenAI',
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

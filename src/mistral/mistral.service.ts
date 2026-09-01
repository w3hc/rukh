import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ChatMistralAI } from '@langchain/mistralai';
import { CustomJsonMemory } from '../memory/custom-memory';
import { randomUUID } from 'crypto';
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ModelStreamEvent } from '../types/llm-stream';

interface CostInfo {
  input_cost: number;
  output_cost: number;
  total_cost: number;
}

@Injectable()
export class MistralService {
  private readonly apiKey: string;
  private readonly model: ChatMistralAI;
  private readonly logger = new Logger(MistralService.name);
  private readonly modelName: string = 'mistral-small-latest';

  // Cost per 1K tokens in USD, per model - https://mistral.ai/pricing/api/
  // (verified 2026-08-31). Rates vary a lot between the models this service
  // actually calls, so they can't share a single flat rate.
  private readonly MODEL_RATES: Record<
    string,
    { inputCost: number; outputCost: number }
  > = {
    'mistral-small-latest': {
      inputCost: 0.00015, // $0.15 per million tokens = $0.00015 per 1K tokens
      outputCost: 0.0006, // $0.60 per million tokens = $0.0006 per 1K tokens
    },
    'mistral-medium-latest': {
      inputCost: 0.0015, // $1.50 per million tokens = $0.0015 per 1K tokens
      outputCost: 0.0075, // $7.50 per million tokens = $0.0075 per 1K tokens
    },
    // Large is cheaper than Medium but gated behind a paid subscription
    // tier; a key without that tier gets a 403 tier_not_allowed on it.
    'mistral-large-latest': {
      inputCost: 0.0005, // $0.50 per million tokens = $0.0005 per 1K tokens
      outputCost: 0.0015, // $1.50 per million tokens = $0.0015 per 1K tokens
    },
    'ministral-3b-latest': {
      inputCost: 0.0001, // $0.10 per million tokens = $0.0001 per 1K tokens
      outputCost: 0.0001, // $0.10 per million tokens = $0.0001 per 1K tokens
    },
  };

  constructor() {
    this.apiKey = process.env.MISTRAL_API_KEY;
    if (!this.apiKey) {
      this.logger.error('MISTRAL_API_KEY environment variable is not set');
      throw new Error('MISTRAL_API_KEY environment variable is not set');
    }

    // No output ceiling. It used to be 1000 tokens - roughly 4000 characters -
    // which silently truncated any answer longer than a few paragraphs, such
    // as a column rewritten row by row, mid-sentence. Left unset rather than
    // raised to a number, so the limit is whatever the model actually allows
    // instead of a constant that has to be revisited every time the model
    // changes.
    this.model = new ChatMistralAI({
      apiKey: this.apiKey,
      modelName: this.modelName,
      temperature: 0.3,
    });

    this.logger.log('MistralService initialized successfully');
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
    modelName: string = this.modelName,
  ): CostInfo {
    const rates =
      this.MODEL_RATES[modelName] ?? this.MODEL_RATES[this.modelName];
    const inputCost = Number(
      ((inputTokens / 1000) * rates.inputCost).toFixed(6),
    );
    const outputCost = Number(
      ((outputTokens / 1000) * rates.outputCost).toFixed(6),
    );
    const totalCost = Number((inputCost + outputCost).toFixed(6));

    return {
      input_cost: inputCost,
      output_cost: outputCost,
      total_cost: totalCost,
    };
  }

  /**
   * Assembles the turn Mistral is asked to answer: the system prompt, the
   * stored history, then the new message.
   *
   * The system content used to be folded into the first user message as
   * `System: ...\n\nUser: ...`, and only on the first turn - which meant the
   * two were mutually exclusive, so a request carrying instructions dropped
   * the entire conversation history on the floor. A real SystemMessage keeps
   * the two independent, and lets the instructions ride along on every turn
   * the way the Anthropic and OpenAI services already do.
   */
  private buildMessages(
    message: string,
    history: { role: string; content: string }[],
    systemPrompt?: string,
  ) {
    const messages = [];

    if (systemPrompt) {
      this.logger.debug(
        `Using system prompt (${systemPrompt.length} characters)`,
      );
      messages.push(new SystemMessage(systemPrompt));
    }

    history.forEach((msg) => {
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else if (msg.role === 'assistant') {
        messages.push(new AIMessage(msg.content));
      }
    });

    messages.push(new HumanMessage(message));
    return messages;
  }

  /**
   * Process a message with a specific Mistral model
   * Used for RAG file selection with mistral-small
   */
  async processMessageWithModel(
    message: string,
    modelName: string = 'mistral-small-latest',
    sessionId?: string,
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
    const usedSessionId = sessionId || randomUUID();

    this.logger.log(
      `Processing message [${requestId}] with model ${modelName}`,
    );

    try {
      // Create a model instance with the specified model name
      const model = new ChatMistralAI({
        apiKey: this.apiKey,
        modelName: modelName,
        temperature: 0.3,
        maxTokens: 1000,
      });

      const langChainMessages = [];

      // Add system message first if provided
      if (systemPrompt) {
        this.logger.debug(
          `Using system prompt (${systemPrompt.length} characters)`,
        );
        langChainMessages.push(
          new HumanMessage(`System: ${systemPrompt}\n\nUser: ${message}`),
        );
      } else {
        langChainMessages.push(new HumanMessage(message));
      }

      // Use LangChain's ChatMistralAI
      const response = await model.invoke(langChainMessages);
      const responseContent = response.content.toString();

      // Estimate token usage
      const allText = langChainMessages.reduce((total, msg) => {
        if (typeof msg.content === 'string') {
          return total + msg.content.length;
        }
        return total;
      }, 0);

      const usage = {
        input_tokens: Math.ceil(allText / 4),
        output_tokens: Math.ceil(responseContent.length / 4),
      };

      // Calculate cost
      const cost = this.calculateCost(
        usage.input_tokens,
        usage.output_tokens,
        modelName,
      );

      this.logger.debug({
        message: `Mistral API response [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          model: modelName,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          total_cost: cost.total_cost,
        },
      });

      return {
        content: responseContent,
        sessionId: usedSessionId,
        usage,
        cost,
      };
    } catch (error) {
      this.logger.error({
        message: `Error processing message with Mistral ${modelName} [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new HttpException(
        `Failed to process message with Mistral AI (${modelName})`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
      `Processing message [${requestId}] for session [${sessionId}] with Mistral`,
    );

    try {
      const { history } = await this.getConversationHistory(sessionId);

      const langChainMessages = this.buildMessages(
        message,
        history,
        systemPrompt,
      );

      const containsUploadedFile = message.includes('Uploaded file (');

      this.logger.debug('Full message to be sent to Mistral:');
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
        `Chat history length: ${langChainMessages.length} messages`,
      );

      this.logger.debug({
        message: `Mistral API request [${requestId}]`,
        requestData: {
          message_length: message.length,
          history_length: langChainMessages.length,
          system_prompt_length: systemPrompt?.length || 0,
          has_file: containsUploadedFile,
          has_system_prompt: !!systemPrompt,
          timestamp: new Date().toISOString(),
        },
      });

      // Log message structure for debugging
      this.logger.debug('Messages to be sent to Mistral:');
      this.logger.debug(
        JSON.stringify(
          langChainMessages.map((msg) => ({
            type: msg._getType(),
            content_preview:
              typeof msg.content === 'string'
                ? msg.content.substring(0, 100) +
                  (msg.content.length > 100 ? '...' : '')
                : String(msg.content).substring(0, 100),
          })),
          null,
          2,
        ),
      );

      // Use LangChain's ChatMistralAI
      const response = await this.model.invoke(langChainMessages);
      const responseContent = response.content.toString();

      // Estimate token usage based on all message content
      const allText = langChainMessages.reduce((total, msg) => {
        if (typeof msg.content === 'string') {
          return total + msg.content.length;
        }
        return total;
      }, 0);

      const usage = {
        // Roughly estimate: 1 token ≈ 4 characters
        input_tokens: Math.ceil(allText / 4),
        output_tokens: Math.ceil(responseContent.length / 4),
      };

      // Calculate cost based on estimated token usage
      const cost = this.calculateCost(usage.input_tokens, usage.output_tokens);

      this.logger.debug({
        message: `Mistral API response [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          model: this.modelName,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          input_cost: cost.input_cost,
          output_cost: cost.output_cost,
          total_cost: cost.total_cost,
          timestamp: new Date().toISOString(),
        },
      });

      // Save the original message (without system prompt) to conversation history
      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      return {
        content: responseContent,
        sessionId,
        usage,
        cost,
      };
    } catch (error) {
      this.logger.error({
        message: `Error processing message with Mistral [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to process message with Mistral AI',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * LangChain chunks carry either a plain string or an array of content
   * parts; flatten both to the text the caller can append.
   */
  private chunkToText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part: any) =>
          typeof part === 'string' ? part : (part?.text ?? ''),
        )
        .join('');
    }
    return '';
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
      `Streaming message [${requestId}] for session [${sessionId}] with Mistral`,
    );

    try {
      const { history } = await this.getConversationHistory(sessionId);

      const langChainMessages = this.buildMessages(
        message,
        history,
        systemPrompt,
      );

      let content = '';

      const stream = await this.model.stream(langChainMessages);
      for await (const chunk of stream) {
        const text = this.chunkToText(chunk?.content);
        if (text) {
          content += text;
          yield { type: 'text', text };
        }
      }

      const responseContent = content || 'No text content in response';

      // Mistral over LangChain reports no token counts, so estimate them the
      // same way the non-streaming path does: roughly 1 token per 4 chars
      const allText = langChainMessages.reduce((total, msg) => {
        if (typeof msg.content === 'string') {
          return total + msg.content.length;
        }
        return total;
      }, 0);

      const usage = {
        input_tokens: Math.ceil(allText / 4),
        output_tokens: Math.ceil(responseContent.length / 4),
      };

      const cost = this.calculateCost(usage.input_tokens, usage.output_tokens);

      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      this.logger.debug({
        message: `Mistral stream completed [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          model: this.modelName,
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
        message: `Error streaming message with Mistral [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to stream message with Mistral AI',
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

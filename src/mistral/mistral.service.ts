import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ChatMistralAI } from '@langchain/mistralai';
import { CustomJsonMemory } from '../memory/custom-memory';
import { randomUUID } from 'crypto';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

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
  private readonly modelName: string = 'mistral-large-2411';

  // Cost per 1K tokens in USD - Ministral 3B rates
  private readonly COST_RATES = {
    inputCost: 0.00004, // $0.04 per million tokens = $0.00004 per 1K tokens
    outputCost: 0.00004, // $0.04 per million tokens = $0.00004 per 1K tokens
  };

  constructor() {
    this.apiKey = process.env.MISTRAL_API_KEY;
    if (!this.apiKey) {
      this.logger.error('MISTRAL_API_KEY environment variable is not set');
      throw new Error('MISTRAL_API_KEY environment variable is not set');
    }

    this.model = new ChatMistralAI({
      apiKey: this.apiKey,
      modelName: this.modelName,
      temperature: 0.3,
      maxTokens: 1000,
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
      `Processing message [${requestId}] for session [${sessionId}] with Mistral`,
    );

    try {
      const { history, isFirstMessage } =
        await this.getConversationHistory(sessionId);

      // Convert history to LangChain message format
      const langChainMessages = [];

      // Add system message first if provided and it's the first message
      if (isFirstMessage && systemPrompt) {
        this.logger.debug(
          `Using system prompt (${systemPrompt.length} characters)`,
        );
        // For Mistral via LangChain, we add system content as the first user message
        langChainMessages.push(
          new HumanMessage(`System: ${systemPrompt}\n\nUser: ${message}`),
        );
      } else {
        // Add all history messages first
        history.forEach((msg) => {
          if (msg.role === 'user') {
            langChainMessages.push(new HumanMessage(msg.content));
          } else if (msg.role === 'assistant') {
            langChainMessages.push(new AIMessage(msg.content));
          }
        });

        // Add the current message
        langChainMessages.push(new HumanMessage(message));
      }

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

      if (isFirstMessage && systemPrompt) {
        this.logger.debug(
          `First message includes ${systemPrompt.length} characters of system prompt`,
        );
      }

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

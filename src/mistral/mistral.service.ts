import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ChatMistralAI } from '@langchain/mistralai';
import { CustomJsonMemory } from '../memory/custom-memory';
import { v4 as uuidv4 } from 'uuid';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

@Injectable()
export class MistralService {
  private readonly apiKey: string;
  private readonly model: ChatMistralAI;
  private readonly logger = new Logger(MistralService.name);
  // private readonly modelName: string = 'mistral-large-2411';
  private readonly modelName: string = 'mistral-large-2411';

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

  async processMessage(
    message: string,
    sessionId: string = uuidv4(),
    contextContent,
  ): Promise<{
    content: string;
    sessionId: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  }> {
    this.logger.log(
      `Processing message with contextContent: ${contextContent}]`,
    );
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Processing message [${requestId}] for session [${sessionId}]`,
    );

    try {
      const { history } = await memory.loadMemoryVariables();
      const { isFirstMessage } = await this.getConversationHistory(sessionId);

      // Convert history to LangChain message format
      const langChainMessages = [];

      // First message should include context content
      if (isFirstMessage && contextContent && contextContent.length > 0) {
        this.logger.debug(
          `Using context content (${contextContent.length} characters)`,
        );

        // Add the first message with context prepended
        langChainMessages.push(
          new HumanMessage(`${contextContent}\n\n${message}`),
        );
      } else {
        // Add all history messages
        history.forEach((msg) => {
          if (msg.role === 'user') {
            langChainMessages.push(new HumanMessage(msg.content));
          } else {
            langChainMessages.push(new AIMessage(msg.content));
          }
        });

        // Add the current message
        langChainMessages.push(new HumanMessage(message));
      }

      this.logger.debug('Full message to be sent to Mistral:');
      this.logger.debug('----------------------------------------');
      this.logger.debug(`Request ID: ${requestId}`);
      this.logger.debug(`Session ID: ${sessionId}`);
      this.logger.debug('Message Content:');

      if (message.length > 1000) {
        this.logger.debug(
          `${message.substring(0, 100)}...${message.substring(message.length - 100)}`,
        );
      } else {
        this.logger.debug(message);
      }

      this.logger.debug('----------------------------------------');
      this.logger.debug(`Total message length: ${message.length} characters`);
      this.logger.debug(
        `Chat history length: ${langChainMessages.length} messages`,
      );
      this.logger.debug(`Is first message: ${isFirstMessage}`);
      this.logger.debug(
        `Context content length: ${contextContent ? contextContent.length : 0} characters`,
      );

      this.logger.debug({
        message: `Mistral API request [${requestId}]`,
        requestData: {
          message_length: message.length,
          history_length: langChainMessages.length,
          timestamp: new Date().toISOString(),
        },
      });

      // Log full message content to verify context inclusion
      this.logger.debug('Messages to be sent to Mistral:');
      this.logger.debug(
        JSON.stringify(
          langChainMessages.map((msg) => ({
            role: msg._getType(),
            content:
              msg.content.substring(0, 100) +
              (msg.content.length > 100 ? '...' : ''),
          })),
          null,
          2,
        ),
      );

      if (isFirstMessage && contextContent) {
        this.logger.debug(
          `First message includes ${contextContent.length} characters of context content`,
        );
      }

      // Use LangChain's ChatMistralAI
      const response = await this.model.invoke(langChainMessages);
      const responseContent = response.content.toString();

      // Estimate token usage
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

      this.logger.debug({
        message: `Mistral API response [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          timestamp: new Date().toISOString(),
        },
      });

      // Save the original message to conversation history
      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      return {
        content: responseContent,
        sessionId,
        usage,
      };
    } catch (error) {
      this.logger.error({
        message: `Error processing message [${requestId}]`,
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

import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ChatMistralAI } from '@langchain/mistralai';
import { CustomJsonMemory } from '../memory/custom-memory';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MistralService {
  private readonly apiKey: string;
  private readonly model: ChatMistralAI;
  private readonly logger = new Logger(MistralService.name);
  private readonly modelName: string = 'ministral-3b-2410';

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
    systemPrompt?: string, // Added system prompt parameter
  ): Promise<{
    content: string;
    sessionId: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  }> {
    const requestId = this.generateRequestId();
    const memory = new CustomJsonMemory(sessionId);

    this.logger.log(
      `Processing message [${requestId}] for session [${sessionId}]`,
    );

    try {
      const { history } = await memory.loadMemoryVariables();

      const messages = history.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

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

      this.logger.debug('----------------------------------------');
      this.logger.debug(`Total message length: ${message.length} characters`);
      this.logger.debug(`Chat history length: ${messages.length} messages`);

      // Add system message at the beginning if provided
      if (systemPrompt) {
        messages.unshift({
          role: 'system',
          content: systemPrompt,
        });
      }

      messages.push({
        role: 'user',
        content: message,
      });

      this.logger.debug({
        message: `Mistral API request [${requestId}]`,
        requestData: {
          message_length: message.length,
          history_length: messages.length,
          has_file: containsUploadedFile,
          has_system_prompt: !!systemPrompt,
          timestamp: new Date().toISOString(),
        },
      });

      // Use LangChain's ChatMistralAI with system message
      const response = await this.model.invoke(messages);
      const responseContent = response.content.toString();

      // LangChain doesn't directly expose token usage in its standard response
      // So we need to estimate based on text length
      const usage = {
        // Roughly estimate: 1 token ≈ 4 characters
        input_tokens: Math.ceil(
          messages.reduce((total, msg) => total + msg.content.length, 0) / 4,
        ),
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

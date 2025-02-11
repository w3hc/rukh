import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ChatMistralAI } from '@langchain/mistralai';
import { CustomJsonMemory } from '../memory/custom-memory';
import { v4 as uuidv4 } from 'uuid';
import { BaseMessage } from '@langchain/core/messages';

@Injectable()
export class MistralService {
  private readonly apiKey: string;
  private readonly model: ChatMistralAI;
  private readonly logger = new Logger(MistralService.name);

  constructor() {
    this.apiKey = process.env.MISTRAL_API_KEY;
    if (!this.apiKey) {
      this.logger.error('MISTRAL_API_KEY environment variable is not set');
      throw new Error('MISTRAL_API_KEY environment variable is not set');
    }

    this.model = new ChatMistralAI({
      apiKey: this.apiKey,
      modelName: 'mistral-tiny',
      temperature: 0.7,
      maxTokens: 500,
    });

    this.logger.log('MistralService initialized');
  }

  async processMessage(
    message: string,
    sessionId: string = uuidv4(),
  ): Promise<{ content: string; sessionId: string }> {
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

      messages.push({
        role: 'user',
        content: message,
      });

      const response = await this.model.call(messages);
      const responseContent = response.content.toString();

      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      this.logger.log({
        message: `Conversation updated [${requestId}]`,
        sessionId,
        messageCount: messages.length + 1,
      });

      return {
        content: responseContent,
        sessionId,
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

  async getConversationHistory(sessionId: string) {
    const memory = new CustomJsonMemory(sessionId);
    return memory.loadMemoryVariables();
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

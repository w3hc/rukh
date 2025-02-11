import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ChatMistralAI } from '@langchain/mistralai';
import { CustomJsonMemory } from '../memory/custom-memory';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MistralService {
  private readonly apiKey: string;
  private readonly model: ChatMistralAI;
  private readonly logger = new Logger(MistralService.name);

  constructor() {
    // Initialize Mistral API key from environment variables
    this.apiKey = process.env.MISTRAL_API_KEY;
    if (!this.apiKey) {
      this.logger.error('MISTRAL_API_KEY environment variable is not set');
      throw new Error('MISTRAL_API_KEY environment variable is not set');
    }

    // Initialize the Mistral AI model with configuration
    this.model = new ChatMistralAI({
      apiKey: this.apiKey,
      modelName: 'mistral-tiny', // Using the tiny model for faster responses
      temperature: 0.7, // Controls randomness (0.0 - 1.0)
      maxTokens: 500, // Maximum length of generated responses
    });

    this.logger.log('MistralService initialized successfully');
  }

  /**
   * Process a user message and generate a response using Mistral AI
   * @param message - The user's input message
   * @param sessionId - Optional session ID for conversation continuity
   * @returns Promise containing the AI response and session ID
   */
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
      // Load conversation history for the session
      const { history } = await memory.loadMemoryVariables();

      // Format messages for the API
      const messages = history.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Add the new message to the conversation
      messages.push({
        role: 'user',
        content: message,
      });

      // Log request details for debugging
      this.logger.debug({
        message: `Mistral API request [${requestId}]`,
        requestData: {
          message_length: message.length,
          history_length: messages.length,
          timestamp: new Date().toISOString(),
        },
      });

      // Get response from Mistral AI
      const response = await this.model.call(messages);
      const responseContent = response.content.toString();

      // Save the conversation context
      await memory.saveContext(
        { input: message },
        { response: responseContent },
      );

      // Log response details
      this.logger.debug({
        message: `Mistral API response [${requestId}]`,
        responseData: {
          response_length: responseContent.length,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        content: responseContent,
        sessionId,
      };
    } catch (error) {
      // Log error details
      this.logger.error({
        message: `Error processing message [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        timestamp: new Date().toISOString(),
      });

      // Rethrow HTTP exceptions as-is
      if (error instanceof HttpException) {
        throw error;
      }

      // Convert other errors to HTTP exceptions
      throw new HttpException(
        'Failed to process message with Mistral AI',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Retrieve conversation history for a specific session
   * @param sessionId - The session ID to retrieve history for
   * @returns Promise containing the conversation history
   */
  async getConversationHistory(sessionId: string) {
    const memory = new CustomJsonMemory(sessionId);
    return memory.loadMemoryVariables();
  }

  /**
   * Delete conversation history for a specific session
   * @param sessionId - The session ID to delete history for
   * @returns Promise<boolean> indicating if deletion was successful
   */
  async deleteConversation(sessionId: string): Promise<boolean> {
    const memory = new CustomJsonMemory(sessionId);
    const { history } = await memory.loadMemoryVariables();
    if (history.length > 0) {
      await memory.saveContext({ input: '' }, { response: '' });
      return true;
    }
    return false;
  }

  /**
   * Generate a unique request ID for tracking
   * @returns string A unique request identifier
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

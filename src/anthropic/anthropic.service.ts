import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { CustomJsonMemory } from '../memory/custom-memory';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  id: string;
  content: Array<{
    type: string;
    text?: string;
  }>;
  model: string;
  role: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

@Injectable()
export class AnthropicService {
  private readonly apiKey: string;
  private readonly logger = new Logger(AnthropicService.name);
  private readonly model: string = 'claude-3-7-sonnet-20250219';
  private readonly apiUrl: string = 'https://api.anthropic.com/v1/messages';
  private readonly apiVersion: string = '2023-06-01';

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

  async processMessage(
    message: string,
    sessionId: string = uuidv4(),
    systemPrompt?: string,
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
          temperature: 0.3,
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

        this.logger.debug({
          message: `Anthropic API response [${requestId}]`,
          responseData: {
            response_length: responseContent.length,
            model: this.model,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            timestamp: new Date().toISOString(),
          },
        });

        return {
          content: responseContent,
          sessionId,
          usage,
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

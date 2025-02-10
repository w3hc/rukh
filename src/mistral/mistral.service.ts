import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';

interface MistralRequestBody {
  model: string;
  messages: {
    role: string;
    content: string;
  }[];
  temperature: number;
  max_tokens: number;
}

interface MistralResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

@Injectable()
export class MistralService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.mistral.ai/v1/chat/completions';
  private readonly logger = new Logger(MistralService.name);

  constructor() {
    this.apiKey = process.env.MISTRAL_API_KEY;
    if (!this.apiKey) {
      this.logger.error('MISTRAL_API_KEY environment variable is not set');
      throw new Error('MISTRAL_API_KEY environment variable is not set');
    }
    this.logger.log('MistralService initialized');
  }

  async processMessage(message: string): Promise<string> {
    const requestId = this.generateRequestId();
    this.logger.log(`Processing message [${requestId}]`);

    try {
      const requestBody: MistralRequestBody = {
        model: 'ministral-3b-2410',
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      };

      this.logger.log({
        message: `Mistral API request [${requestId}]`,
        requestBody: {
          ...requestBody,
          message_length: message.length,
          timestamp: new Date().toISOString(),
        },
      });

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        this.logger.error({
          message: `Mistral API error [${requestId}]`,
          statusCode: response.status,
          error: error,
        });
        throw new HttpException(
          error.error?.message || 'Mistral API error',
          HttpStatus.BAD_REQUEST,
        );
      }

      const data = (await response.json()) as MistralResponse;

      this.logger.log({
        message: `Mistral API response [${requestId}]`,
        responseData: {
          id: data.id,
          model: data.model,
          usage: data.usage,
          finish_reason: data.choices[0]?.finish_reason,
          response_length: data.choices[0]?.message?.content?.length,
          output: data.choices[0]?.message?.content,
          timestamp: new Date().toISOString(),
        },
      });

      return data.choices[0]?.message?.content || 'No response generated';
    } catch (error) {
      this.logger.error({
        message: `Error processing message [${requestId}]`,
        error: error instanceof Error ? error.message : 'Unknown error',
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

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

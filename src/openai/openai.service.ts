import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAICompatibleService } from '../providers/openai-compatible.service';

@Injectable()
export class OpenAIService extends OpenAICompatibleService {
  readonly key = 'openai';
  readonly label = 'gpt-4o';
  protected readonly model = 'gpt-4o';
  protected readonly apiUrl = 'https://api.openai.com/v1/chat/completions';
  protected readonly displayName = 'OpenAI';
  protected readonly logger = new Logger(OpenAIService.name);
  protected readonly apiKey?: string;

  // Cost per 1K tokens in USD - GPT-4o rates
  // https://developers.openai.com/api/docs/pricing (verified 2026-09-11)
  readonly pricing = {
    inputCost: 0.0025, // $2.50 per million tokens = $0.0025 per 1K tokens
    outputCost: 0.01, // $10 per million tokens = $0.01 per 1K tokens
  };

  constructor(private configService: ConfigService) {
    super();
    this.apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!this.apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY environment variable is not set. OpenAI service will be unavailable.',
      );
    } else {
      this.logger.log('OpenAIService initialized successfully');
    }
  }
}

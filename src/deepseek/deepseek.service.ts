import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OpenAICompatibleService,
  ParsedUsage,
} from '../providers/openai-compatible.service';

@Injectable()
export class DeepSeekService extends OpenAICompatibleService {
  readonly key = 'deepseek';
  readonly label = 'deepseek-v4-flash';
  protected readonly model = 'deepseek-v4-flash';
  protected readonly apiUrl = 'https://api.deepseek.com/v1/chat/completions';
  protected readonly displayName = 'DeepSeek';
  protected readonly logger = new Logger(DeepSeekService.name);
  protected readonly apiKey?: string;

  // Cost per 1K tokens in USD - DeepSeek Flash standard (peak) rates
  // verified 2026-09-11. `deepseek-v4-flash` is a legacy alias, still
  // accepted, routed to and billed at the current `deepseek-flash` price.
  // Input (cache miss): $0.30 per million tokens = $0.0003 per 1K tokens
  // Output: $1.20 per million tokens = $0.0012 per 1K tokens
  // Cache write: $0.30 per million tokens = $0.0003 per 1K tokens
  // Cache hit: $0.006 per million tokens = $0.000006 per 1K tokens
  readonly pricing = {
    inputCost: 0.0003,
    outputCost: 0.0012,
    cacheWriteCost: 0.0003,
    cacheReadCost: 0.000006,
  };

  constructor(private configService: ConfigService) {
    super();
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!this.apiKey) {
      this.logger.warn(
        'DEEPSEEK_API_KEY environment variable is not set. DeepSeek service will be unavailable.',
      );
    } else {
      this.logger.log('DeepSeekService initialized successfully');
    }
  }

  /** DeepSeek splits the prompt into cache misses and cache hits. */
  protected parseUsage(raw: any): ParsedUsage {
    const miss = raw?.prompt_cache_miss_tokens ?? 0;
    const hit = raw?.prompt_cache_hit_tokens ?? 0;
    const usage = {
      input_tokens: raw?.prompt_tokens ?? 0,
      output_tokens: raw?.completion_tokens ?? 0,
      cache_creation_input_tokens: miss,
      cache_read_input_tokens: hit,
    };
    return { usage, cache: { write: miss, read: hit } };
  }
}

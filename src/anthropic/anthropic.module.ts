import { Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';
import { AnthropicWebSearchProvider } from './anthropic-web-search.provider';

@Module({
  providers: [AnthropicService, AnthropicWebSearchProvider],
  exports: [AnthropicService, AnthropicWebSearchProvider],
})
export class AnthropicModule {}

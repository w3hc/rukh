import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { AnthropicService } from '../anthropic/anthropic.service';
import { AnthropicWebSearchProvider } from '../anthropic/anthropic-web-search.provider';
import { DeepSeekModule } from '../deepseek/deepseek.module';
import { DeepSeekService } from '../deepseek/deepseek.service';
import { MistralModule } from '../mistral/mistral.module';
import { MistralService } from '../mistral/mistral.service';
import { OpenAIModule } from '../openai/openai.module';
import { OpenAIService } from '../openai/openai.service';
import { LLM_PROVIDERS, LlmProvider } from './llm-provider';
import { ProviderRegistry } from './provider-registry.service';

// Every provider a request can be routed to, in fallback order
const PROVIDERS = [
  MistralService,
  AnthropicService,
  OpenAIService,
  DeepSeekService,
  AnthropicWebSearchProvider,
];

@Module({
  imports: [MistralModule, AnthropicModule, OpenAIModule, DeepSeekModule],
  providers: [
    {
      provide: LLM_PROVIDERS,
      useFactory: (...providers: LlmProvider[]) => providers,
      inject: PROVIDERS,
    },
    ProviderRegistry,
  ],
  exports: [
    ProviderRegistry,
    MistralModule,
    AnthropicModule,
    OpenAIModule,
    DeepSeekModule,
  ],
})
export class ProvidersModule {}

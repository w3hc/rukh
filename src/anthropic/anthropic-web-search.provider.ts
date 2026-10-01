import { Injectable } from '@nestjs/common';
import { ModelStreamEvent } from '../types/llm-stream';
import { LlmProvider, LlmResponse } from '../providers/llm-provider';
import { AnthropicService } from './anthropic.service';

/**
 * Anthropic with the web search and fetch server tools. Kept out of the
 * fallback chain: each search is billed on top of tokens, so it only runs
 * when a request or context asks for it.
 */
@Injectable()
export class AnthropicWebSearchProvider implements LlmProvider {
  readonly key = 'anthropic-web-search';
  readonly fallbackEligible = false;

  constructor(private readonly anthropic: AnthropicService) {}

  get label(): string {
    return this.anthropic.label;
  }

  get pricing() {
    return this.anthropic.pricing;
  }

  isAvailable(): boolean {
    return this.anthropic.isAvailable();
  }

  ask(
    message: string,
    sessionId: string,
    systemPrompt?: string,
  ): Promise<LlmResponse> {
    return this.anthropic.processMessageWithWebSearch(
      message,
      sessionId,
      systemPrompt,
    );
  }

  stream(
    message: string,
    sessionId: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    return this.anthropic.streamMessageWithWebSearch(
      message,
      sessionId,
      systemPrompt,
      signal,
    );
  }
}

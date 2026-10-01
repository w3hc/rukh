import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDERS, LlmProvider } from './llm-provider';

@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly providers = new Map<string, LlmProvider>();

  constructor(@Inject(LLM_PROVIDERS) providers: LlmProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.key)) {
        throw new Error(`Duplicate LLM provider key: ${provider.key}`);
      }
      this.providers.set(provider.key, provider);
    }
    this.logger.log(
      `Registered providers: ${providers
        .map((p) => `${p.key}${p.isAvailable() ? '' : ' (unavailable)'}`)
        .join(', ')}`,
    );
  }

  get(key: string): LlmProvider | undefined {
    return this.providers.get(key);
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  keys(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * The models to try, in order: the selected one first, then every
   * available fallback-eligible provider in registration order.
   *
   * The selected provider is kept even when unavailable, so a request for a
   * model with no key configured fails over visibly instead of silently
   * running on another one from the start.
   */
  fallbackChain(selected: string): string[] {
    const fallbacks = [...this.providers.values()]
      .filter(
        (p) => p.key !== selected && p.fallbackEligible && p.isAvailable(),
      )
      .map((p) => p.key);
    return [selected, ...fallbacks];
  }
}

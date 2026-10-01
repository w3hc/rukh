import { ModelStreamEvent, StreamCost, StreamUsage } from '../types/llm-stream';

/** Per-1K-token rates in USD for the model a provider calls by default. */
export interface TokenRates {
  inputCost: number;
  outputCost: number;
  cacheWriteCost?: number;
  cacheReadCost?: number;
}

export interface LlmResponse {
  content: string;
  sessionId: string;
  usage?: StreamUsage;
  cost?: StreamCost;
}

/**
 * One model a request can be routed to.
 *
 * `AppService` never names a provider: it looks one up by `key` in the
 * {@link ProviderRegistry}, so adding a provider means implementing this
 * interface and registering the class under {@link LLM_PROVIDERS}.
 */
export interface LlmProvider {
  /** The value clients send as `model`, e.g. `anthropic`. */
  readonly key: string;
  /** The model name reported back in responses, e.g. `claude-sonnet-5`. */
  readonly label: string;
  readonly pricing: TokenRates;
  /**
   * Whether the provider may be tried when another one fails. Off for
   * providers with per-call fees that should only run when asked for.
   */
  readonly fallbackEligible: boolean;

  /** False when the provider lacks the configuration it needs, e.g. a key. */
  isAvailable(): boolean;

  ask(
    message: string,
    sessionId: string,
    systemPrompt?: string,
  ): Promise<LlmResponse>;

  stream(
    message: string,
    sessionId: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent>;
}

export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');

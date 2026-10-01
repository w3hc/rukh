import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { CustomJsonMemory } from '../memory/custom-memory';
import { ModelStreamEvent, StreamCost } from '../types/llm-stream';
import { LlmProvider, LlmResponse, TokenRates } from './llm-provider';

export interface CacheTokens {
  write?: number;
  read?: number;
}

/**
 * What every provider service shares: conversation memory, cost accounting,
 * request IDs and the API key guard.
 *
 * Subclasses implement the provider-specific `processMessage` and
 * `streamMessage`; `ask` and `stream` route to them.
 */
export abstract class BaseLlmService implements LlmProvider {
  abstract readonly key: string;
  abstract readonly label: string;
  abstract readonly pricing: TokenRates;
  readonly fallbackEligible: boolean = true;

  protected abstract readonly logger: Logger;
  protected abstract readonly apiKey?: string;
  /** Display name used in logs and error messages, e.g. `OpenAI`. */
  protected abstract readonly displayName: string;

  abstract processMessage(
    message: string,
    sessionId?: string,
    systemPrompt?: string,
  ): Promise<LlmResponse>;

  abstract streamMessage(
    message: string,
    sessionId?: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent>;

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  ask(
    message: string,
    sessionId: string,
    systemPrompt?: string,
  ): Promise<LlmResponse> {
    return this.processMessage(message, sessionId, systemPrompt);
  }

  stream(
    message: string,
    sessionId: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    return this.streamMessage(message, sessionId, systemPrompt, signal);
  }

  async getConversationHistory(sessionId: string) {
    const memory = new CustomJsonMemory(sessionId);
    const { history } = await memory.loadMemoryVariables();
    return {
      history,
      isFirstMessage: history.length === 0,
    };
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

  /**
   * Cost in USD from per-1K-token rates. Cache tokens are part of
   * `inputTokens` and billed at their own rate, falling back to the input
   * rate when the provider has none.
   */
  protected calculateCost(
    inputTokens: number,
    outputTokens: number,
    rates: TokenRates = this.pricing,
    cache: CacheTokens = {},
  ): StreamCost {
    const write = cache.write ?? 0;
    const read = cache.read ?? 0;
    const regularInput = inputTokens - write - read;

    const inputCost =
      (regularInput / 1000) * rates.inputCost +
      (write / 1000) * (rates.cacheWriteCost ?? rates.inputCost) +
      (read / 1000) * (rates.cacheReadCost ?? rates.inputCost);
    const outputCost = (outputTokens / 1000) * rates.outputCost;

    const input_cost = Number(inputCost.toFixed(6));
    const output_cost = Number(outputCost.toFixed(6));
    return {
      input_cost,
      output_cost,
      total_cost: Number((input_cost + output_cost).toFixed(6)),
    };
  }

  /** Throws a 503 when the provider is called without a key configured. */
  protected requireApiKey(): void {
    if (!this.apiKey) {
      this.logger.error(`${this.displayName} API key is not configured`);
      throw new HttpException(
        `${this.displayName} service unavailable`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  protected generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

import { LlmProvider } from './llm-provider';

/**
 * Gives a mocked provider service the {@link LlmProvider} surface, routing
 * `ask` and `stream` to its `processMessage` and `streamMessage` mocks.
 */
export function asLlmProvider<T extends Record<string, any>>(
  key: string,
  mock: T,
  { label = key, fallbackEligible = true } = {},
): T & LlmProvider {
  return Object.assign(mock, {
    key,
    label,
    pricing: { inputCost: 0, outputCost: 0 },
    fallbackEligible,
    isAvailable: () => true,
    ask: (...args: unknown[]) => mock.processMessage(...args),
    stream: (...args: unknown[]) => mock.streamMessage(...args),
  });
}

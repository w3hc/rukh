import { LlmProvider } from './llm-provider';

/**
 * Gives a mocked provider service the {@link LlmProvider} surface, routing
 * `ask` and `stream` to its `processMessage` and `streamMessage` mocks.
 */
export function asLlmProvider<T extends object>(
  key: string,
  mock: T,
  { label = key, fallbackEligible = true } = {},
): T & LlmProvider {
  const service = mock as unknown as {
    processMessage: LlmProvider['ask'];
    streamMessage: LlmProvider['stream'];
  };
  return Object.assign(mock, {
    key,
    label,
    pricing: { inputCost: 0, outputCost: 0 },
    fallbackEligible,
    isAvailable: () => true,
    ask: (...args: Parameters<LlmProvider['ask']>) =>
      service.processMessage(...args),
    stream: (...args: Parameters<LlmProvider['stream']>) =>
      service.streamMessage(...args),
  });
}

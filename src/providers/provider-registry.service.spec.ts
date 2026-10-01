import { LlmProvider } from './llm-provider';
import { ProviderRegistry } from './provider-registry.service';

function fakeProvider(
  key: string,
  { available = true, fallbackEligible = true } = {},
): LlmProvider {
  return {
    key,
    label: `${key}-model`,
    pricing: { inputCost: 0, outputCost: 0 },
    fallbackEligible,
    isAvailable: () => available,
    ask: jest.fn(),
    stream: jest.fn(),
  };
}

describe('ProviderRegistry', () => {
  it('looks providers up by key', () => {
    const anthropic = fakeProvider('anthropic');
    const registry = new ProviderRegistry([anthropic]);

    expect(registry.get('anthropic')).toBe(anthropic);
    expect(registry.has('anthropic')).toBe(true);
    expect(registry.get('gemini')).toBeUndefined();
    expect(registry.has('gemini')).toBe(false);
  });

  it('rejects duplicate keys', () => {
    expect(
      () =>
        new ProviderRegistry([fakeProvider('openai'), fakeProvider('openai')]),
    ).toThrow('Duplicate LLM provider key: openai');
  });

  it('builds the fallback chain in registration order, selected first', () => {
    const registry = new ProviderRegistry([
      fakeProvider('mistral'),
      fakeProvider('anthropic'),
      fakeProvider('openai'),
    ]);

    expect(registry.fallbackChain('openai')).toEqual([
      'openai',
      'mistral',
      'anthropic',
    ]);
  });

  it('leaves unavailable and non-eligible providers out of the fallbacks', () => {
    const registry = new ProviderRegistry([
      fakeProvider('mistral'),
      fakeProvider('anthropic'),
      fakeProvider('deepseek', { available: false }),
      fakeProvider('anthropic-web-search', { fallbackEligible: false }),
    ]);

    expect(registry.fallbackChain('anthropic')).toEqual([
      'anthropic',
      'mistral',
    ]);
  });

  it('keeps the selected provider even when it is unavailable', () => {
    const registry = new ProviderRegistry([
      fakeProvider('mistral'),
      fakeProvider('deepseek', { available: false }),
    ]);

    expect(registry.fallbackChain('deepseek')).toEqual(['deepseek', 'mistral']);
  });
});

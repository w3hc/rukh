import { Logger } from '@nestjs/common';
import { AskResultService } from './ask-result.service';
import { CostTracker } from '../memory/cost-tracking.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { asLlmProvider } from '../providers/testing';

describe('AskResultService', () => {
  let costTracker: jest.Mocked<Pick<CostTracker, 'trackUsageWithTokens'>>;
  let service: AskResultService;

  const base = () => ({
    output: 'answer',
    model: 'claude',
    sessionId: 's',
    usage: { input_tokens: 1, output_tokens: 2 },
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    costTracker = {
      trackUsageWithTokens: jest.fn().mockResolvedValue(undefined),
    };
    service = new AskResultService(
      new ProviderRegistry([
        asLlmProvider('anthropic', {}, { label: 'claude' }),
      ]),
      costTracker as unknown as CostTracker,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports the public label of a model', () => {
    expect(service.modelLabel('anthropic')).toBe('claude');
    expect(service.modelLabel('unknown')).toBe('unknown');
  });

  it('tracks usage against the anonymous origin', async () => {
    await service.trackUsage(
      { message: 'hi' },
      's',
      'claude',
      'input',
      'output',
      { input_tokens: 1, output_tokens: 2 },
    );

    expect(costTracker.trackUsageWithTokens).toHaveBeenCalledWith(
      'anonymous',
      'hi',
      's',
      'claude',
      'input',
      'output',
      1,
      2,
    );
  });

  it('swallows a tracking failure', async () => {
    costTracker.trackUsageWithTokens.mockRejectedValue(new Error('disk'));

    await expect(
      service.trackUsage({ message: 'hi' }, 's', 'claude', 'i', 'o', {
        input_tokens: 0,
        output_tokens: 0,
      }),
    ).resolves.toBeUndefined();
  });

  it('leaves cost and RAG off when there are none', () => {
    expect(service.complete(base(), undefined, undefined)).toEqual(base());
  });

  it('passes the generation cost through without a selection cost', () => {
    const cost = { input_cost: 0.1, output_cost: 0.2, total_cost: 0.3 };

    expect(service.complete(base(), cost, undefined).cost).toBe(cost);
  });

  it('adds the selection cost and attaches the RAG metadata', () => {
    const ragMetadata = {
      selectedFiles: ['a.md'],
      totalFilesAvailable: 3,
      selectionCost: { input_cost: 0.01, output_cost: 0.02, total_cost: 0.03 },
    };

    const response = service.complete(
      base(),
      { input_cost: 0.1, output_cost: 0.2, total_cost: 0.3 },
      ragMetadata,
    );

    expect(response.cost).toEqual({
      input_cost: 0.11,
      output_cost: 0.22,
      total_cost: 0.33,
    });
    expect(response.rag).toBe(ragMetadata);
  });
});

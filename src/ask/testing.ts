import { Test } from '@nestjs/testing';
import { MistralService } from '../mistral/mistral.service';
import { AnthropicService } from '../anthropic/anthropic.service';
import { OpenAIService } from '../openai/openai.service';
import { DeepSeekService } from '../deepseek/deepseek.service';
import { CostTracker } from '../memory/cost-tracking.service';
import { RagService } from '../rag/rag.service';
import { NOTIFIER } from '../notifications/notifier';
import { LLM_PROVIDERS } from '../providers/llm-provider';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { asLlmProvider } from '../providers/testing';
import { AskPreparationService } from './ask-preparation.service';
import { AskResultService } from './ask-result.service';
import { AskService } from './ask.service';
import { AskStreamService } from './ask-stream.service';
import { ContextLoaderService } from './context-loader.service';
import { UploadService } from './upload.service';

const providerMock = (extra: Record<string, jest.Mock> = {}) => ({
  processMessage: jest.fn(),
  streamMessage: jest.fn(),
  getConversationHistory: jest.fn().mockResolvedValue({
    history: [],
    isFirstMessage: true,
  }),
  ...extra,
});

/**
 * The ask pipeline wired for real, with the model providers, RAG, cost
 * tracking and notifications mocked out.
 */
export async function createAskTestingModule() {
  const notifier = { notify: jest.fn().mockResolvedValue(undefined) };

  const module = await Test.createTestingModule({
    providers: [
      AskService,
      AskStreamService,
      AskPreparationService,
      AskResultService,
      ContextLoaderService,
      UploadService,
      ProviderRegistry,
      { provide: MistralService, useValue: providerMock() },
      {
        provide: AnthropicService,
        useValue: providerMock({
          processMessageWithWebSearch: jest.fn(),
          streamMessageWithWebSearch: jest.fn(),
        }),
      },
      { provide: OpenAIService, useValue: providerMock() },
      { provide: DeepSeekService, useValue: providerMock() },
      {
        provide: LLM_PROVIDERS,
        useFactory: (mistral, anthropic, openai, deepseek) => [
          asLlmProvider('mistral', mistral, {
            label: 'mistral-small-latest',
          }),
          asLlmProvider('anthropic', anthropic, {
            label: 'claude-sonnet-5',
          }),
          asLlmProvider('openai', openai, { label: 'gpt-4o' }),
          asLlmProvider('deepseek', deepseek, {
            label: 'deepseek-v4-flash',
          }),
          {
            ...asLlmProvider(
              'anthropic-web-search',
              {},
              {
                label: 'claude-sonnet-5',
                fallbackEligible: false,
              },
            ),
            ask: (...args) => anthropic.processMessageWithWebSearch(...args),
            stream: (...args) => anthropic.streamMessageWithWebSearch(...args),
          },
        ],
        inject: [
          MistralService,
          AnthropicService,
          OpenAIService,
          DeepSeekService,
        ],
      },
      {
        provide: CostTracker,
        useValue: {
          trackUsageWithTokens: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: RagService,
        useValue: {
          selectRelevantFiles: jest.fn().mockResolvedValue({
            selectedFiles: ['file1.md', 'file2.md'],
            selectionCost: {
              input_cost: 0.0001,
              output_cost: 0.00005,
              total_cost: 0.00015,
            },
          }),
          buildContextWithSelectedFiles: jest
            .fn()
            .mockResolvedValue('Mock RAG context'),
        },
      },
      { provide: NOTIFIER, useValue: notifier },
    ],
  }).compile();

  const contextLoader = module.get(ContextLoaderService);
  jest.spyOn(contextLoader, 'getModelOverride').mockResolvedValue(undefined);
  jest
    .spyOn(contextLoader, 'load')
    .mockResolvedValue({ systemPrompt: 'Mock context information' });

  return {
    askService: module.get(AskService),
    askStreamService: module.get(AskStreamService),
    contextLoader,
    mistralService: module.get(MistralService),
    anthropicService: module.get(AnthropicService),
    openaiService: module.get(OpenAIService),
    deepseekService: module.get(DeepSeekService),
    costTracker: module.get(CostTracker),
    notifier,
  };
}

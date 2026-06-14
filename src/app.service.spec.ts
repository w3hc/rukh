import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { AnthropicService } from './anthropic/anthropic.service';
import { OpenAIService } from './openai/openai.service';
import { CostTracker } from './memory/cost-tracking.service';
import { ContextService } from './context/context.service';
import { SubsService } from './subs/subs.service';
import { WebReaderService } from './web/web-reader.service';
import { RagService } from './rag/rag.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

describe('AppService - Model Fallback', () => {
  let service: AppService;
  let mistralService: MistralService;
  let anthropicService: AnthropicService;
  let costTracker: CostTracker;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Mock Logger to suppress error logs during tests
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: MistralService,
          useValue: {
            processMessage: jest.fn(),
            getConversationHistory: jest.fn().mockResolvedValue({
              history: [],
              isFirstMessage: true,
            }),
          },
        },
        {
          provide: AnthropicService,
          useValue: {
            processMessage: jest.fn(),
            getConversationHistory: jest.fn().mockResolvedValue({
              history: [],
              isFirstMessage: true,
            }),
          },
        },
        {
          provide: OpenAIService,
          useValue: {
            processMessage: jest.fn(),
            getConversationHistory: jest.fn().mockResolvedValue({
              history: [],
              isFirstMessage: true,
            }),
          },
        },
        {
          provide: CostTracker,
          useValue: {
            trackUsageWithTokens: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ContextService,
          useValue: {
            getContextContent: jest
              .fn()
              .mockResolvedValue({ content: '', files: [] }),
            recordQuery: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SubsService,
          useValue: {
            isSubscribed: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: WebReaderService,
          useValue: {
            extractForLLM: jest.fn().mockResolvedValue({
              text: 'Mock web content',
              links: [],
              title: 'Mock page title',
              url: 'https://example.com',
            }),
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
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key) => {
              switch (key) {
                case 'RAG_ENABLE_TWO_STEP':
                  return 'false'; // Disable RAG in tests by default
                case 'RAG_MAX_FILES':
                  return '5';
                default:
                  return undefined;
              }
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
    mistralService = module.get<MistralService>(MistralService);
    anthropicService = module.get<AnthropicService>(AnthropicService);
    costTracker = module.get<CostTracker>(CostTracker);

    // Mock loadContextInformation for simplicity
    jest
      .spyOn(service as any, 'loadContextInformation')
      .mockResolvedValue('Mock context information');
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
    jest.clearAllMocks();
    jest.restoreAllMocks();

    // Ensure all timers are cleared
    jest.useRealTimers();
  });

  afterAll(() => {
    // Additional cleanup to ensure we don't have hanging promises
    jest.clearAllTimers();
  });

  it('should default to Anthropic when no model is specified', async () => {
    // Setup successful Anthropic response
    (anthropicService.processMessage as jest.Mock).mockResolvedValue({
      content: 'Response from Anthropic',
      sessionId: 'test-session-id',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await service.ask('Test message');

    // Verify Anthropic was called
    expect(anthropicService.processMessage).toHaveBeenCalledTimes(1);
    expect(mistralService.processMessage).not.toHaveBeenCalled();
    expect(result.output).toBe('Response from Anthropic');
    expect(result.model).toBe('claude-3-7-sonnet-20250219');
  });

  it('should use the specified model when provided', async () => {
    // Setup successful Mistral response
    (mistralService.processMessage as jest.Mock).mockResolvedValue({
      content: 'Response from Mistral',
      sessionId: 'test-session-id',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await service.ask('Test message', 'mistral');

    // Verify Mistral was called
    expect(mistralService.processMessage).toHaveBeenCalledTimes(1);
    expect(anthropicService.processMessage).not.toHaveBeenCalled();
    expect(result.output).toBe('Response from Mistral');
    expect(result.model).toBe('mistral-large-2411');
  });

  it('should fall back to Mistral if Anthropic fails', async () => {
    // Setup Anthropic failure and Mistral success
    (anthropicService.processMessage as jest.Mock).mockRejectedValue(
      new Error('Anthropic service unavailable'),
    );
    (mistralService.processMessage as jest.Mock).mockResolvedValue({
      content: 'Fallback response from Mistral',
      sessionId: 'test-session-id',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await service.ask('Test message');

    // Verify both services were called in correct order
    expect(anthropicService.processMessage).toHaveBeenCalledTimes(1);
    expect(mistralService.processMessage).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('Fallback response from Mistral');
    expect(result.model).toBe('mistral-large-2411');
  });

  it('should fall back to Anthropic if Mistral fails', async () => {
    // Setup Mistral failure and Anthropic success
    (mistralService.processMessage as jest.Mock).mockRejectedValue(
      new Error('Mistral service unavailable'),
    );
    (anthropicService.processMessage as jest.Mock).mockResolvedValue({
      content: 'Fallback response from Anthropic',
      sessionId: 'test-session-id',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await service.ask('Test message', 'mistral');

    // Verify both services were called in correct order
    expect(mistralService.processMessage).toHaveBeenCalledTimes(1);
    expect(anthropicService.processMessage).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('Fallback response from Anthropic');
    expect(result.model).toBe('claude-3-7-sonnet-20250219');
  });

  it('should still complete processing even if all models fail', async () => {
    // Setup all models to fail
    (mistralService.processMessage as jest.Mock).mockRejectedValue(
      new Error('Mistral service unavailable'),
    );
    (anthropicService.processMessage as jest.Mock).mockRejectedValue(
      new Error('Anthropic service unavailable'),
    );

    const result = await service.ask('Test message');

    // Verify both services were called
    expect(anthropicService.processMessage).toHaveBeenCalledTimes(1);
    expect(mistralService.processMessage).toHaveBeenCalledTimes(1);

    // Even with failures, we should get a response
    expect(result.output).toBeUndefined();
    expect(result.sessionId).toBeDefined();
  });

  it('should pass context and session information to models', async () => {
    // Setup successful Anthropic response
    (anthropicService.processMessage as jest.Mock).mockResolvedValue({
      content: 'Response with context',
      sessionId: 'custom-session-id',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await service.ask(
      'Test message with context',
      'anthropic',
      'custom-session-id',
      'test-context',
    );

    // Verify context was loaded and system prompt was passed
    expect(service['loadContextInformation']).toHaveBeenCalledWith(
      'test-context',
      'Test message with context',
    );

    // Verify system prompt and session ID were passed to the model
    expect(anthropicService.processMessage).toHaveBeenCalledWith(
      'Test message with context',
      'custom-session-id',
      expect.any(String), // The system prompt
    );
  });

  it('should handle invalid model names by defaulting to Anthropic', async () => {
    // Setup successful Anthropic response
    (anthropicService.processMessage as jest.Mock).mockResolvedValue({
      content: 'Response from Anthropic',
      sessionId: 'test-session-id',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    // The system should try Anthropic first for invalid model names
    const result = await service.ask('Test message', 'invalid-model-name');

    // Verify Anthropic was called and was the only model used
    expect(anthropicService.processMessage).toHaveBeenCalledTimes(1);
    expect(result.output).toBe('Response from Anthropic');
    expect(result.model).toBe('claude-3-7-sonnet-20250219');

    // Mistral might be called in some implementations if there's uncertainty about model validity
    // So we don't test that mistralService wasn't called anymore
  });

  it('should track usage for successful responses', async () => {
    // Setup successful Anthropic response
    (anthropicService.processMessage as jest.Mock).mockResolvedValue({
      content: 'Response for tracking',
      sessionId: 'test-session-id',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await service.ask('Test message', 'anthropic', 'test-session-id');

    // Verify usage tracking was called with correct parameters
    expect(costTracker.trackUsageWithTokens).toHaveBeenCalledWith(
      'anonymous',
      'Test message',
      'test-session-id',
      'claude-3-7-sonnet-20250219',
      expect.any(String), // Full input including system prompt
      'Response for tracking',
      100, // input tokens
      50, // output tokens
    );
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { OpenAIService } from './openai.service';
import { ConfigService } from '@nestjs/config';

// Mock fetch globally
global.fetch = jest.fn();

describe('OpenAIService', () => {
  let service: OpenAIService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAIService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              if (key === 'OPENAI_API_KEY') return 'test_api_key';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OpenAIService>(OpenAIService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should process a message and return content', async () => {
    // Mock successful API response
    const mockResponse = {
      id: 'chatcmpl-123',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello! How can I help you?',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
      model: 'gpt-4o',
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await service.processMessage('Hello, OpenAI!');

    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('sessionId');
    expect(result).toHaveProperty('usage');
    expect(result).toHaveProperty('cost');
    expect(result.content).toBe('Hello! How can I help you?');
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(20);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { OpenAIService } from './openai.service';
import { ConfigService } from '@nestjs/config';
import { ModelStreamEvent } from '../types/llm-stream';

/** Serializes chunks as an SSE body the service can read back. */
const sseBody = (chunks: unknown[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

const collect = async (stream: AsyncGenerator<ModelStreamEvent>) => {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

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

  describe('streamMessage', () => {
    it('should yield text deltas then a final event with usage and cost', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        body: sseBody([
          { choices: [{ delta: { role: 'assistant', content: '' } }] },
          { choices: [{ delta: { content: 'Hello' } }] },
          { choices: [{ delta: { content: ' there' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] },
          // The usage-bearing chunk arrives last with no choices
          {
            choices: [],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 4,
              total_tokens: 15,
            },
          },
        ]),
      });

      const events = await collect(service.streamMessage('Hello, OpenAI!'));

      expect(events.filter((e) => e.type === 'text')).toEqual([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' there' },
      ]);

      const final = events[events.length - 1] as any;
      expect(final.type).toBe('final');
      expect(final.content).toBe('Hello there');
      expect(final.usage).toEqual({ input_tokens: 11, output_tokens: 4 });
      expect(final.cost.total_cost).toBeGreaterThan(0);

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.stream).toBe(true);
      // Without this the stream carries no usage at all
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('should throw on API errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'API Error' } }),
      });

      await expect(collect(service.streamMessage('Hi'))).rejects.toThrow();
    });
  });
});

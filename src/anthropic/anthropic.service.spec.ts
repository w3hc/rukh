import { Test, TestingModule } from '@nestjs/testing';
import { AnthropicService } from './anthropic.service';
import { ConfigService } from '@nestjs/config';
import { HttpException, Logger } from '@nestjs/common';
import { ModelStreamEvent } from '../types/llm-stream';

/** Serializes objects as an SSE body the service can read back. */
const sseBody = (events: Record<string, unknown>[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(
          encoder.encode(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          ),
        );
      }
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

global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        id: 'msg_mock',
        content: [{ type: 'text', text: 'Mocked Anthropic Response' }],
        model: 'claude-3-haiku-20240307',
        role: 'assistant',
      }),
  }),
) as jest.Mock;

describe('AnthropicService', () => {
  let service: AnthropicService;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Mock Logger to suppress error logs during tests
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnthropicService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              if (key === 'ANTHROPIC_API_KEY') return 'test_api_key';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AnthropicService>(AnthropicService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processMessage', () => {
    it('should process a message and return content', async () => {
      const result = await service.processMessage('Hello, Anthropic!');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('sessionId');
      expect(result.content).toBe('Mocked Anthropic Response');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test_api_key',
            'anthropic-version': expect.any(String),
          }),
          body: expect.any(String),
        }),
      );
    });

    it('should handle API errors', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: 'API Error' } }),
        }),
      );

      await expect(service.processMessage('Error message')).rejects.toThrow(
        HttpException,
      );
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.reject(new Error('Network error')),
      );

      await expect(service.processMessage('Network error')).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('streamMessage', () => {
    it('should yield text deltas then a final event with usage and cost', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          body: sseBody([
            {
              type: 'message_start',
              message: { usage: { input_tokens: 12 } },
            },
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Hello' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: ' world' },
            },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: 7 },
            },
            { type: 'message_stop' },
          ]),
        }),
      );

      const events = await collect(service.streamMessage('Hi'));

      expect(events.filter((e) => e.type === 'text')).toEqual([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
      ]);

      const final = events[events.length - 1] as any;
      expect(final.type).toBe('final');
      expect(final.content).toBe('Hello world');
      expect(final.usage).toEqual({ input_tokens: 12, output_tokens: 7 });
      expect(final.cost.total_cost).toBeGreaterThan(0);

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.stream).toBe(true);
    });

    it('should surface an in-band stream error', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          body: sseBody([{ type: 'error', error: { message: 'overloaded' } }]),
        }),
      );

      await expect(collect(service.streamMessage('Hi'))).rejects.toThrow(
        HttpException,
      );
    });

    it('should handle API errors', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: { message: 'API Error' } }),
        }),
      );

      await expect(collect(service.streamMessage('Hi'))).rejects.toThrow(
        HttpException,
      );
    });

    it('should ask for summarized thinking and forward it separately', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          body: sseBody([
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'thinking', thinking: '' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'thinking_delta', thinking: 'weighing options' },
            },
            {
              type: 'content_block_start',
              index: 1,
              content_block: { type: 'text', text: '' },
            },
            {
              type: 'content_block_delta',
              index: 1,
              delta: { type: 'text_delta', text: 'Answer' },
            },
            { type: 'message_stop' },
          ]),
        }),
      );

      const events = await collect(service.streamMessage('Hi'));

      expect(events.filter((e) => e.type === 'thinking')).toEqual([
        { type: 'thinking', text: 'weighing options' },
      ]);

      // Reasoning is not the answer: it must not leak into the saved content
      const final = events[events.length - 1] as any;
      expect(final.content).toBe('Answer');

      const body = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.thinking).toEqual({
        type: 'adaptive',
        display: 'summarized',
      });
      // No ANTHROPIC_EFFORT set, so the API's own default applies
      expect(body.output_config).toBeUndefined();
    });

    it('should end quietly when the caller aborts mid-request', async () => {
      const controller = new AbortController();

      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
            // The client hangs up while the request is still in flight
            controller.abort();
          }),
      );

      const events = await collect(
        service.streamMessage('Hi', 'session', undefined, controller.signal),
      );

      // No throw, no events: an abandoned stream is not an error to report
      expect(events).toEqual([]);
      expect(controller.signal.aborted).toBe(true);
    });

    it('should not issue a request at all if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const before = (global.fetch as jest.Mock).mock.calls.length;
      const events = await collect(
        service.streamMessage('Hi', 'session', undefined, controller.signal),
      );

      expect(events).toEqual([]);
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(before);
    });
  });

  describe('streamMessageWithWebSearch', () => {
    it('should reset the streamed preamble and keep only the answer', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          body: sseBody([
            {
              type: 'message_start',
              message: { usage: { input_tokens: 40 } },
            },
            {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Let me search.' },
            },
            { type: 'content_block_stop', index: 0 },
            {
              type: 'content_block_start',
              index: 1,
              content_block: {
                type: 'server_tool_use',
                id: 'srvtoolu_1',
                name: 'web_search',
              },
            },
            {
              type: 'content_block_delta',
              index: 1,
              delta: {
                type: 'input_json_delta',
                partial_json: '{"query":"rukh"}',
              },
            },
            { type: 'content_block_stop', index: 1 },
            {
              type: 'content_block_start',
              index: 2,
              content_block: { type: 'text', text: '' },
            },
            {
              type: 'content_block_delta',
              index: 2,
              delta: { type: 'text_delta', text: 'The answer.' },
            },
            { type: 'content_block_stop', index: 2 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: {
                output_tokens: 30,
                server_tool_use: { web_search_requests: 2 },
              },
            },
          ]),
        }),
      );

      const events = await collect(service.streamMessageWithWebSearch('Hi'));

      expect(events.map((e) => e.type)).toEqual([
        'text',
        'reset',
        'text',
        'final',
      ]);

      const final = events[events.length - 1] as any;
      // The preamble is dropped, matching the non-streaming path
      expect(final.content).toBe('The answer.');
      expect(final.cost.web_search_cost).toBeCloseTo(0.02, 6);
    });

    it('should continue a paused turn and report only the last answer', async () => {
      (global.fetch as jest.Mock)
        .mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            body: sseBody([
              {
                type: 'message_start',
                message: { usage: { input_tokens: 10 } },
              },
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'Still working' },
              },
              { type: 'content_block_stop', index: 0 },
              {
                type: 'message_delta',
                delta: { stop_reason: 'pause_turn' },
                usage: { output_tokens: 5 },
              },
            ]),
          }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            body: sseBody([
              {
                type: 'message_start',
                message: { usage: { input_tokens: 20 } },
              },
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'Done.' },
              },
              { type: 'content_block_stop', index: 0 },
              {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { output_tokens: 8 },
              },
            ]),
          }),
        );

      const events = await collect(service.streamMessageWithWebSearch('Hi'));

      expect(events.map((e) => e.type)).toEqual([
        'text',
        'reset',
        'text',
        'final',
      ]);

      const final = events[events.length - 1] as any;
      expect(final.content).toBe('Done.');
      // Usage is summed across the paused turn and its continuation
      expect(final.usage).toEqual({ input_tokens: 30, output_tokens: 13 });
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // The continuation replays the paused assistant turn verbatim
      const continuation = JSON.parse(
        (global.fetch as jest.Mock).mock.calls[1][1].body,
      );
      expect(continuation.messages[continuation.messages.length - 1]).toEqual({
        role: 'assistant',
        content: [{ type: 'text', text: 'Still working' }],
      });
    });
  });

  describe('getConversationHistory', () => {
    it('should return conversation history and isFirstMessage flag', async () => {
      const result = await service.getConversationHistory('test-session-id');
      expect(result).toHaveProperty('history');
      expect(result).toHaveProperty('isFirstMessage');
    });
  });

  describe('deleteConversation', () => {
    it('should attempt to delete a conversation', async () => {
      const result = await service.deleteConversation('test-session-id');
      expect(typeof result).toBe('boolean');
    });
  });
});

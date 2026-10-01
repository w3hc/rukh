import { Logger } from '@nestjs/common';
import { AskStreamService } from './ask-stream.service';
import { AskResponseDto } from '../dto/ask-response.dto';
import { AskStreamEvent } from '../dto/ask-stream.dto';
import { AnthropicMock, createAskTestingModule, ProviderMock } from './testing';

/** Every event field at once, so assertions can read them without narrowing. */
type CollectedEvent = { type: AskStreamEvent['type'] } & Partial<{
  text: string;
  response: AskResponseDto;
  message: string;
}>;

describe('AskStreamService', () => {
  let service: AskStreamService;
  let mistralService: ProviderMock;
  let anthropicService: AnthropicMock;
  let openaiService: ProviderMock;
  let costTracker: { trackUsageWithTokens: jest.Mock };

  const collect = async (stream: AsyncIterable<AskStreamEvent>) => {
    const events: CollectedEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    return events;
  };

  const modelStream = (
    texts: string[],
    overrides: Record<string, unknown> = {},
  ) =>
    async function* () {
      for (const text of texts) {
        yield { type: 'text', text };
      }
      yield {
        type: 'final',
        content: texts.join(''),
        sessionId: 'test-session-id',
        usage: { input_tokens: 10, output_tokens: 5 },
        cost: {
          input_cost: 0.001,
          output_cost: 0.002,
          total_cost: 0.003,
        },
        ...overrides,
      };
    };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    const testing = await createAskTestingModule();
    service = testing.askStreamService;
    mistralService = testing.mistralService;
    anthropicService = testing.anthropicService;
    openaiService = testing.openaiService;
    costTracker = testing.costTracker;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should stream chunks then a done event carrying the full response', async () => {
    anthropicService.streamMessage.mockImplementation(
      modelStream(['Hello', ' world']),
    );

    const events = await collect(
      service.askStream({
        message: 'test',
        model: 'anthropic',
        sessionId: 'test-session-id',
        stream: true,
      }),
    );

    expect(events.slice(0, 2)).toEqual([
      { type: 'chunk', text: 'Hello' },
      { type: 'chunk', text: ' world' },
    ]);

    const done = events[events.length - 1];
    expect(done.type).toBe('done');
    expect(done.response.output).toBe('Hello world');
    expect(done.response.model).toBe('claude-sonnet-5');
    expect(done.response.sessionId).toBe('test-session-id');
    expect(costTracker.trackUsageWithTokens).toHaveBeenCalled();
  });

  it('should fall back to the next model when the first fails before emitting', async () => {
    anthropicService.streamMessage.mockImplementation(async function* () {
      throw new Error('anthropic down');
    });
    mistralService.streamMessage.mockImplementation(
      modelStream(['Fallback answer']),
    );

    const events = await collect(
      service.askStream({
        message: 'test',
        model: 'anthropic',
        sessionId: 'test-session-id',
        stream: true,
      }),
    );

    expect(events[0]).toEqual({ type: 'chunk', text: 'Fallback answer' });
    expect(events[events.length - 1].response.model).toBe(
      'mistral-small-latest',
    );
  });

  it('should not fall back once text is already on the wire', async () => {
    anthropicService.streamMessage.mockImplementation(async function* () {
      yield { type: 'text', text: 'Half an ans' };
      throw new Error('connection reset');
    });

    const events = await collect(
      service.askStream({
        message: 'test',
        model: 'anthropic',
        sessionId: 'test-session-id',
        stream: true,
      }),
    );

    expect(events[0]).toEqual({ type: 'chunk', text: 'Half an ans' });
    expect(events[1].type).toBe('error');
    expect(events[1].message).toContain('connection reset');
    expect(mistralService.streamMessage).not.toHaveBeenCalled();
  });

  it('should forward a reset and drop the discarded preamble', async () => {
    anthropicService.streamMessageWithWebSearch.mockImplementation(
      async function* () {
        yield { type: 'text', text: 'Let me search.' };
        yield { type: 'reset' };
        yield { type: 'text', text: 'The answer.' };
        yield {
          type: 'final',
          content: 'The answer.',
          sessionId: 'test-session-id',
          usage: { input_tokens: 10, output_tokens: 5 },
          cost: { input_cost: 0.001, output_cost: 0.002, total_cost: 0.003 },
        };
      },
    );

    const events = await collect(
      service.askStream({
        message: 'test',
        model: 'anthropic-web-search',
        sessionId: 'test-session-id',
        stream: true,
      }),
    );

    expect(events.map((e) => e.type)).toEqual([
      'chunk',
      'reset',
      'chunk',
      'done',
    ]);
    expect(events[events.length - 1].response.output).toBe('The answer.');
  });

  it('should pass thinking through without disabling fallback', async () => {
    anthropicService.streamMessage.mockImplementation(async function* () {
      yield { type: 'thinking', text: 'hmm' };
      throw new Error('anthropic down');
    });
    mistralService.streamMessage.mockImplementation(modelStream(['Answer']));

    const events = await collect(
      service.askStream({
        message: 'test',
        model: 'anthropic',
        sessionId: 'test-session-id',
        stream: true,
      }),
    );

    expect(events.map((e) => e.type)).toEqual(['thinking', 'chunk', 'done']);
  });

  it('should stop without falling back once the client has disconnected', async () => {
    const controller = new AbortController();
    anthropicService.streamMessage.mockImplementation(async function* () {
      controller.abort();
      throw new Error('aborted');
    });

    const events = await collect(
      service.askStream(
        {
          message: 'test',
          model: 'anthropic',
          sessionId: 'test-session-id',
          stream: true,
        },
        undefined,
        controller.signal,
      ),
    );

    expect(events).toEqual([]);
    expect(mistralService.streamMessage).not.toHaveBeenCalled();
  });

  it('should emit an error event when every model fails', async () => {
    const failing = async function* () {
      throw new Error('nope');
    };
    anthropicService.streamMessage.mockImplementation(failing);
    mistralService.streamMessage.mockImplementation(failing);
    openaiService.streamMessage.mockImplementation(failing);

    const events = await collect(
      service.askStream({
        message: 'test',
        model: 'anthropic',
        sessionId: 'test-session-id',
        stream: true,
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].message).toContain('All models failed');
  });
});

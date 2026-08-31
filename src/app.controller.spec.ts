import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  const mockFile = {
    fieldname: 'file',
    originalname: 'test.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    buffer: Buffer.from('This is test file content'),
    size: 26,
  } as Express.Multer['File'];

  // The handler now takes the raw req/res so it can write SSE frames; the
  // JSON path only ever touches them when `stream` is set.
  const mockReq = { on: jest.fn() } as unknown as Request;
  const mockRes = {
    status: jest.fn(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: () => {
              return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>Welcome to Rukh</title>
</head>
<body>
    <div class="container">
        <h1>Welcome to Rukh</h1>
    </div>
</body>
</html>`;
            },
            askStream: jest.fn().mockImplementation(async function* () {
              yield { type: 'chunk', text: 'AI ' };
              yield { type: 'chunk', text: 'response' };
              yield {
                type: 'done',
                response: {
                  output: 'AI response',
                  model: 'mistral-large-latest',
                  sessionId: 'test-session-id',
                },
              };
            }),
            ask: jest.fn().mockImplementation(async (askDto) => ({
              output: askDto.model === 'mistral' ? 'AI response' : undefined,
              model:
                askDto.model === 'mistral' ? 'mistral-large-latest' : 'none',
              sessionId: askDto.sessionId || 'generated-session-id',
            })),
          },
        },
        {
          provide: MistralService,
          useValue: {
            processMessage: jest.fn().mockResolvedValue({
              content: 'AI response',
              sessionId: 'test-session-id',
            }),
            getConversationHistory: jest.fn().mockResolvedValue({
              history: [],
              isFirstMessage: true,
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('root', () => {
    it('should return HTML content', () => {
      const result = appController.getHello();
      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('Welcome to Rukh');
      expect(result).toContain('</html>');
    });
  });

  describe('ask', () => {
    it('should return response with no model specified', async () => {
      const result = await appController.ask(
        {
          message: 'test message',
        },
        mockReq,
        mockRes,
      );

      expect(result).toEqual({
        output: undefined,
        model: 'none',
        sessionId: expect.any(String),
      });
    });

    it('should return response with Mistral model', async () => {
      const result = await appController.ask(
        {
          message: 'test message',
          model: 'mistral',
          sessionId: 'test-session-id',
        },
        mockReq,
        mockRes,
      );

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-latest',
        sessionId: 'test-session-id',
      });
    });

    it('should generate sessionId if not provided', async () => {
      const result = await appController.ask(
        {
          message: 'test message',
          model: 'mistral',
        },
        mockReq,
        mockRes,
      );

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-latest',
        sessionId: expect.any(String),
      });
    });
  });

  describe('ask with streaming', () => {
    const collectWrites = (res: Response) =>
      (res.write as jest.Mock).mock.calls.map((call) => call[0]).join('');

    it('should write the stream as server-sent events', async () => {
      const res = {
        status: jest.fn(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as unknown as Response;

      const result = await appController.ask(
        { message: 'test message', model: 'mistral', stream: true },
        mockReq,
        res,
      );

      expect(result).toBeUndefined();
      expect(appService.askStream).toHaveBeenCalled();
      expect(appService.ask).not.toHaveBeenCalled();

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/event-stream; charset=utf-8',
      );

      const body = collectWrites(res);
      expect(body).toContain('event: chunk\ndata: {"text":"AI "}\n\n');
      expect(body).toContain('event: chunk\ndata: {"text":"response"}\n\n');
      expect(body).toContain('event: done\ndata: {');
      expect(body).toContain('"output":"AI response"');
      expect(res.end).toHaveBeenCalled();
    });

    it('should report a mid-stream failure as an error event', async () => {
      (appService.askStream as jest.Mock).mockImplementationOnce(
        async function* () {
          yield { type: 'chunk', text: 'partial' };
          throw new Error('provider exploded');
        },
      );

      const res = {
        status: jest.fn(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as unknown as Response;

      await appController.ask(
        { message: 'test message', stream: true },
        mockReq,
        res,
      );

      const body = collectWrites(res);
      expect(body).toContain('event: error');
      expect(body).toContain('provider exploded');
      expect(res.end).toHaveBeenCalled();
    });

    it('should use the JSON path when stream is false', async () => {
      const result = await appController.ask(
        { message: 'test message', model: 'mistral', stream: false },
        mockReq,
        mockRes,
      );

      expect(appService.askStream).not.toHaveBeenCalled();
      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-latest',
        sessionId: 'generated-session-id',
      });
    });
  });

  describe('ask with file upload', () => {
    it('should process a request with file upload', async () => {
      const result = await appController.ask(
        {
          message: 'test message with file',
          model: 'mistral',
          sessionId: 'test-session-id',
        },
        mockReq,
        mockRes,
        mockFile,
      );

      const askFunction = appService.ask as jest.Mock;
      expect(askFunction).toHaveBeenCalled();

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-latest',
        sessionId: 'test-session-id',
      });
    });

    it('should handle a request with all parameters including file', async () => {
      const result = await appController.ask(
        {
          message: 'test message with file',
          model: 'mistral',
          sessionId: 'test-session-id',
          context: 'custom-context',
        },
        mockReq,
        mockRes,
        mockFile,
      );

      const askFunction = appService.ask as jest.Mock;
      const call = askFunction.mock.calls[0];

      expect(call[0]).toEqual({
        message: 'test message with file',
        model: 'mistral',
        sessionId: 'test-session-id',
        context: 'custom-context',
      });
      expect(call[1]).toBe(mockFile);

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-latest',
        sessionId: 'test-session-id',
      });
    });

    it('should handle a request without file', async () => {
      const result = await appController.ask(
        {
          message: 'test message without file',
          model: 'mistral',
        },
        mockReq,
        mockRes,
        undefined,
      );

      const askFunction = appService.ask as jest.Mock;
      expect(askFunction).toHaveBeenCalled();

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-latest',
        sessionId: 'generated-session-id',
      });
    });
  });
});

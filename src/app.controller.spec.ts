import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { ConfigService } from '@nestjs/config';

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
            ask: jest.fn().mockImplementation(async (askDto) => ({
              output: askDto.model === 'mistral' ? 'AI response' : undefined,
              model: askDto.model === 'mistral' ? 'mistral-large-latest' : 'none',
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
      const result = await appController.ask({
        message: 'test message',
      });

      expect(result).toEqual({
        output: undefined,
        model: 'none',
        sessionId: expect.any(String),
      });
    });

    it('should return response with Mistral model', async () => {
      const result = await appController.ask({
        message: 'test message',
        model: 'mistral',
        sessionId: 'test-session-id',
      });

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-latest',
        sessionId: 'test-session-id',
      });
    });

    it('should generate sessionId if not provided', async () => {
      const result = await appController.ask({
        message: 'test message',
        model: 'mistral',
      });

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-latest',
        sessionId: expect.any(String),
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

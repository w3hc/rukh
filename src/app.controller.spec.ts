import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;
  let mistralService: MistralService;

  const mockTxHash =
    '0x1234567890123456789012345678901234567890123456789012345678901234';
  const mockFile = {
    fieldname: 'file',
    originalname: 'test.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    buffer: Buffer.from('This is test file content'),
    size: 26,
  } as Express.Multer.File;

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
            ask: jest
              .fn()
              .mockImplementation(
                async (
                  message,
                  model,
                  sessionId,
                  walletAddress,
                  context = 'rukh',
                  file,
                ) => ({
                  output: model === 'mistral' ? 'AI response' : undefined,
                  model: model === 'mistral' ? 'mistral-large-2411' : 'none',
                  network: 'arbitrum-sepolia',
                  txHash: mockTxHash,
                  explorerLink: `https://sepolia.arbiscan.io/tx/${mockTxHash}`,
                  sessionId: sessionId || 'generated-session-id',
                }),
              ),
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
    mistralService = app.get<MistralService>(MistralService);
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
    const testWalletAddress = '0x446200cB329592134989B615d4C02f9f3c9E970F';

    it('should return response with no model specified', async () => {
      const result = await appController.ask({
        message: 'test message',
      });

      expect(result).toEqual({
        output: undefined,
        model: 'none',
        network: 'arbitrum-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://sepolia.arbiscan.io/tx/${mockTxHash}`,
        sessionId: expect.any(String),
      });
    });

    it('should return response with Mistral model and wallet address', async () => {
      const result = await appController.ask({
        message: 'test message',
        model: 'mistral',
        sessionId: 'test-session-id',
        walletAddress: testWalletAddress,
      });

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-2411',
        network: 'arbitrum-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://sepolia.arbiscan.io/tx/${mockTxHash}`,
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
        model: 'mistral-large-2411',
        network: 'arbitrum-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://sepolia.arbiscan.io/tx/${mockTxHash}`,
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
        model: 'mistral-large-2411',
        network: 'arbitrum-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://sepolia.arbiscan.io/tx/${mockTxHash}`,
        sessionId: 'test-session-id',
      });
    });

    it('should handle a request with all parameters including file', async () => {
      const testWalletAddress = '0x446200cB329592134989B615d4C02f9f3c9E970F';

      const result = await appController.ask(
        {
          message: 'test message with file',
          model: 'mistral',
          sessionId: 'test-session-id',
          walletAddress: testWalletAddress,
          context: 'custom-context',
        },
        mockFile,
      );

      const askFunction = appService.ask as jest.Mock;
      const call = askFunction.mock.calls[0];

      expect(call[0]).toBe('test message with file');
      expect(call[1]).toBe('mistral');
      expect(call[2]).toBe('test-session-id');
      expect(call[3]).toBe(testWalletAddress);

      expect(result).toEqual({
        output: 'AI response',
        model: 'mistral-large-2411',
        network: 'arbitrum-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://sepolia.arbiscan.io/tx/${mockTxHash}`,
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
        model: 'mistral-large-2411',
        network: 'arbitrum-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://sepolia.arbiscan.io/tx/${mockTxHash}`,
        sessionId: 'generated-session-id',
      });
    });
  });
});

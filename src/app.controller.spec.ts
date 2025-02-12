import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { ConfigService } from '@nestjs/config';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;
  let mistralService: MistralService;

  const mockTxHash =
    '0x1234567890123456789012345678901234567890123456789012345678901234';

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: () => 'Hello World!',
            ask: jest
              .fn()
              .mockImplementation(
                async (message, model, sessionId, walletAddress) => ({
                  output: model === 'mistral' ? 'AI response' : undefined,
                  model: model === 'mistral' ? 'ministral-3b-2410' : 'none',
                  network: 'mantle-sepolia',
                  txHash: mockTxHash,
                  explorerLink: `https://explorer.sepolia.mantle.xyz/tx/${mockTxHash}`,
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
        network: 'mantle-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://explorer.sepolia.mantle.xyz/tx/${mockTxHash}`,
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
        model: 'ministral-3b-2410',
        network: 'mantle-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://explorer.sepolia.mantle.xyz/tx/${mockTxHash}`,
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
        model: 'ministral-3b-2410',
        network: 'mantle-sepolia',
        txHash: mockTxHash,
        explorerLink: `https://explorer.sepolia.mantle.xyz/tx/${mockTxHash}`,
        sessionId: expect.any(String),
      });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { ConfigService } from '@nestjs/config';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;
  let mistralService: MistralService;

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
              .mockImplementation(async (message, model, sessionId) => ({
                output: model === 'mistral' ? 'AI response' : undefined,
                model: model === 'mistral' ? 'ministral-3b-2410' : 'none',
                network: 'arbitrum-sepolia',
                txHash:
                  '0x1234567890123456789012345678901234567890123456789012345678901234',
                sessionId: sessionId || 'generated-session-id',
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
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
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
        network: 'arbitrum-sepolia',
        txHash: expect.any(String),
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
        model: 'ministral-3b-2410',
        network: 'arbitrum-sepolia',
        txHash: expect.any(String),
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
        network: 'arbitrum-sepolia',
        txHash: expect.any(String),
        sessionId: expect.any(String),
      });
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;
  let mistralService: MistralService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: MistralService,
          useValue: {
            processMessage: jest.fn().mockResolvedValue({
              content: 'AI response',
              sessionId: 'test-session-id',
            }),
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
        network: 'mainnet',
        model: 'none',
        txHash:
          '0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
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
        network: 'mainnet',
        model: 'mistral-tiny',
        txHash:
          '0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
        output: 'AI response',
        sessionId: 'test-session-id',
      });

      expect(mistralService.processMessage).toHaveBeenCalledWith(
        'test message',
        'test-session-id',
      );
    });

    it('should generate sessionId if not provided', async () => {
      const result = await appController.ask({
        message: 'test message',
        model: 'mistral',
      });

      expect(result).toEqual({
        network: 'mainnet',
        model: 'mistral-tiny',
        txHash:
          '0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
        output: 'AI response',
        sessionId: expect.any(String),
      });

      expect(mistralService.processMessage).toHaveBeenCalledWith(
        'test message',
        expect.any(String),
      );
    });
  });
});

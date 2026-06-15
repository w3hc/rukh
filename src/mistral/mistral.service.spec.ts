import { Test, TestingModule } from '@nestjs/testing';
import { MistralService } from './mistral.service';
import { HttpException } from '@nestjs/common';

// Mock the ChatMistralAI
jest.mock('@langchain/mistralai', () => {
  return {
    ChatMistralAI: jest.fn().mockImplementation(() => {
      return {
        invoke: jest.fn().mockResolvedValue({
          content: 'Mocked response from Mistral',
        }),
      };
    }),
  };
});

describe('MistralService', () => {
  let service: MistralService;

  beforeEach(async () => {
    process.env.MISTRAL_API_KEY = 'test-api-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [MistralService],
    }).compile();

    service = module.get<MistralService>(MistralService);
  });

  afterEach(() => {
    delete process.env.MISTRAL_API_KEY;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw error if MISTRAL_API_KEY is not set', () => {
    delete process.env.MISTRAL_API_KEY;
    expect(() => new MistralService()).toThrow(
      'MISTRAL_API_KEY environment variable is not set',
    );
  });

  describe('processMessage', () => {
    it('should process a message successfully', async () => {
      const message = 'Hello, Mistral!';
      const result = await service.processMessage(message);

      expect(result).toBeDefined();
      expect(result.content).toBe('Mocked response from Mistral');
      expect(result.sessionId).toBeDefined();
      expect(result.usage).toBeDefined();
      expect(result.usage.input_tokens).toBeGreaterThan(0);
      expect(result.usage.output_tokens).toBeGreaterThan(0);
      expect(result.cost).toBeDefined();
      expect(result.cost.total_cost).toBeGreaterThanOrEqual(0);
    });

    it('should process a message with session ID', async () => {
      const message = 'Hello, Mistral!';
      const sessionId = 'test-session-id';
      const result = await service.processMessage(message, sessionId);

      expect(result.sessionId).toBe(sessionId);
    });

    it('should process a message with system prompt', async () => {
      const message = 'Hello, Mistral!';
      const systemPrompt = 'You are a helpful assistant.';
      const result = await service.processMessage(
        message,
        undefined,
        systemPrompt,
      );

      expect(result).toBeDefined();
      expect(result.content).toBe('Mocked response from Mistral');
    });
  });

  describe('processMessageWithModel', () => {
    it('should process a message with specific model', async () => {
      const message = 'Test message';
      const modelName = 'mistral-small-latest';
      const result = await service.processMessageWithModel(message, modelName);

      expect(result).toBeDefined();
      expect(result.content).toBe('Mocked response from Mistral');
      expect(result.usage).toBeDefined();
      expect(result.cost).toBeDefined();
    });

    it('should process a message with custom model and session ID', async () => {
      const message = 'Test message';
      const modelName = 'mistral-small-latest';
      const sessionId = 'custom-session';
      const result = await service.processMessageWithModel(
        message,
        modelName,
        sessionId,
      );

      expect(result.sessionId).toBe(sessionId);
    });

    it('should process a message with system prompt', async () => {
      const message = 'Test message';
      const modelName = 'mistral-small-latest';
      const systemPrompt = 'You are an expert.';
      const result = await service.processMessageWithModel(
        message,
        modelName,
        undefined,
        systemPrompt,
      );

      expect(result).toBeDefined();
      expect(result.content).toBe('Mocked response from Mistral');
    });
  });

  describe('getConversationHistory', () => {
    it('should return empty history for new session', async () => {
      const sessionId = 'new-session';
      const result = await service.getConversationHistory(sessionId);

      expect(result).toBeDefined();
      expect(result.history).toBeDefined();
      expect(result.isFirstMessage).toBe(true);
    });

    it('should return conversation history for existing session', async () => {
      const sessionId = 'test-session';
      // First, create a conversation
      await service.processMessage('Hello', sessionId);

      const result = await service.getConversationHistory(sessionId);

      expect(result).toBeDefined();
      expect(result.isFirstMessage).toBe(false);
    });
  });

  describe('deleteConversation', () => {
    it('should return false for non-existent session', async () => {
      const sessionId = 'non-existent-session';
      const result = await service.deleteConversation(sessionId);

      expect(result).toBe(false);
    });

    it('should delete existing conversation', async () => {
      const sessionId = 'test-delete-session';
      // First, create a conversation
      await service.processMessage('Hello', sessionId);

      const result = await service.deleteConversation(sessionId);

      expect(result).toBe(true);
    });
  });
});

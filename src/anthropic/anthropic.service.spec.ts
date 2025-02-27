import { Test, TestingModule } from '@nestjs/testing';
import { AnthropicService } from './anthropic.service';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';

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

  beforeEach(async () => {
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

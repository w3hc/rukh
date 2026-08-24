import { Test, TestingModule } from '@nestjs/testing';
import { RagService } from './rag.service';
import { MistralService } from '../mistral/mistral.service';
import { ContextService } from '../context/context.service';
import { WebReaderService } from '../web/web-reader.service';
import { Logger } from '@nestjs/common';

describe('RagService', () => {
  let service: RagService;
  let mistralService: jest.Mocked<MistralService>;

  beforeEach(async () => {
    const mockMistralService = {
      processMessageWithModel: jest.fn().mockResolvedValue({
        content: '[1, 2]',
        sessionId: 'test-session',
        usage: { input_tokens: 100, output_tokens: 50 },
        cost: { input_cost: 0.001, output_cost: 0.001, total_cost: 0.002 },
      }),
    };

    const mockContextService = {
      listContextFiles: jest.fn(),
      getFileContent: jest.fn(),
    };

    const mockWebReaderService = {
      extractForLLM: jest.fn().mockResolvedValue({
        text: 'Extracted web content',
        title: 'Web Page Title',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: MistralService, useValue: mockMistralService },
        { provide: ContextService, useValue: mockContextService },
        { provide: WebReaderService, useValue: mockWebReaderService },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
    mistralService = module.get(MistralService);

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('selectRelevantFiles', () => {
    it('should return empty arrays if context index does not exist', async () => {
      const result = await service.selectRelevantFiles(
        'non-existent-context',
        'test message',
      );

      expect(result).toEqual({
        selectedFiles: [],
        selectionCost: null,
        selectedUrls: [],
      });
    });

    it('should handle errors gracefully and return fallback', async () => {
      mistralService.processMessageWithModel.mockRejectedValue(
        new Error('API Error'),
      );

      const result = await service.selectRelevantFiles(
        'non-existent-context',
        'test message',
      );

      expect(result).toEqual({
        selectedFiles: [],
        selectedUrls: [],
        selectionCost: null,
      });
    });
  });

  describe('buildContextWithSelectedFiles', () => {
    it('should return empty string if no files or URLs are selected', async () => {
      const result = await service.buildContextWithSelectedFiles(
        'test-context',
        [],
        [],
      );

      expect(result).toBe('');
    });

    it('should handle errors gracefully', async () => {
      const result = await service.buildContextWithSelectedFiles(
        'test-context',
        ['non-existent.md'],
      );

      expect(result).toContain('Context: test-context');
    });
  });
});

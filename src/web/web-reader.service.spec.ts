import { Test, TestingModule } from '@nestjs/testing';
import { WebReaderService } from './web-reader.service';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';

// Mock puppeteer
jest.mock('puppeteer-core', () => ({
  launch: jest.fn(),
}));

// Mock execSync
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

describe('WebReaderService', () => {
  let service: WebReaderService;
  let configService: ConfigService;
  let mockBrowser: any;
  let mockPage: any;

  const mockTavilyApiKey = 'test-tavily-key';

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock page
    mockPage = {
      setUserAgent: jest.fn().mockResolvedValue(undefined),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
      goto: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue('<html><body>Test</body></html>'),
      evaluate: jest.fn().mockResolvedValue({
        title: 'Test Page',
        links: [{ text: 'Link 1', url: 'https://example.com/link1' }],
        textContent: 'Test content',
      }),
    };

    // Setup mock browser
    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue(undefined),
    };

    // Mock puppeteer.launch
    const puppeteer = require('puppeteer-core');
    puppeteer.launch.mockResolvedValue(mockBrowser);

    // Mock execSync for Chrome detection
    const { execSync } = require('child_process');
    execSync.mockReturnValue('');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebReaderService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'TAVILY_API_KEY') return mockTavilyApiKey;
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebReaderService>(WebReaderService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('extractForLLM', () => {
    it('should extract content from a webpage successfully', async () => {
      const url = 'https://example.com';
      const timeout = 5;

      const result = await service.extractForLLM(url, timeout);

      expect(result).toEqual({
        text: 'Test content',
        links: [{ text: 'Link 1', url: 'https://example.com/link1' }],
        title: 'Test Page',
        url: url,
      });

      expect(mockPage.goto).toHaveBeenCalledWith(url, {
        waitUntil: 'networkidle2',
        timeout: timeout * 1000,
      });
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should use default timeout of 5 seconds', async () => {
      const url = 'https://example.com';

      await service.extractForLLM(url);

      expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(5000);
      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(5000);
    });

    it('should throw HttpException for invalid URL', async () => {
      const invalidUrl = 'not-a-valid-url';

      await expect(service.extractForLLM(invalidUrl)).rejects.toThrow(
        HttpException,
      );
      await expect(service.extractForLLM(invalidUrl)).rejects.toThrow(
        'Invalid URL format',
      );
    });

    it('should handle timeout errors', async () => {
      const url = 'https://example.com';
      const timeoutError = new Error('Navigation timeout');
      timeoutError.name = 'TimeoutError';

      mockPage.goto.mockRejectedValueOnce(timeoutError);

      await expect(service.extractForLLM(url, 3)).rejects.toThrow(
        HttpException,
      );
      await expect(service.extractForLLM(url, 3)).rejects.toThrow(
        'Request timed out after 3 seconds',
      );

      // Ensure browser is closed even on error
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should close browser on error', async () => {
      const url = 'https://example.com';
      mockPage.goto.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.extractForLLM(url)).rejects.toThrow(HttpException);

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should set custom user agent', async () => {
      const url = 'https://example.com';

      await service.extractForLLM(url);

      expect(mockPage.setUserAgent).toHaveBeenCalledWith(
        'Rukh Web Reader Service/1.0',
      );
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // Mock global fetch
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should perform web search successfully', async () => {
      const query = 'test query';
      const mockResponse = {
        results: [
          {
            title: 'Result 1',
            url: 'https://example.com/1',
            content: 'Content 1',
            score: 0.95,
          },
        ],
        answer: 'This is the answer',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.search(query, 5);

      expect(result.query).toBe(query);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe('Result 1');
      expect(result.answer).toBe('This is the answer');
      expect(result.responseTime).toBeDefined();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.tavily.com/search',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: expect.stringContaining(query),
        }),
      );
    });

    it('should throw error if TAVILY_API_KEY is not set', async () => {
      // Create a new service without API key
      const moduleWithoutKey: TestingModule = await Test.createTestingModule({
        providers: [
          WebReaderService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(null),
            },
          },
        ],
      }).compile();

      const serviceWithoutKey =
        moduleWithoutKey.get<WebReaderService>(WebReaderService);

      await expect(serviceWithoutKey.search('test query')).rejects.toThrow(
        HttpException,
      );
      await expect(serviceWithoutKey.search('test query')).rejects.toThrow(
        'Web search is not configured',
      );
    });

    it('should throw error for empty query', async () => {
      await expect(service.search('')).rejects.toThrow(HttpException);
      await expect(service.search('')).rejects.toThrow(
        'Search query cannot be empty',
      );
    });

    it('should handle API errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid API key' }),
      });

      await expect(service.search('test query')).rejects.toThrow(HttpException);
    });

    it('should handle rate limit errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limit exceeded' }),
      });

      await expect(service.search('test query')).rejects.toThrow(
        'Search rate limit exceeded',
      );
    });

    it('should limit maxResults to 10', async () => {
      const mockResponse = {
        results: [],
        answer: '',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await service.search('test query', 20);

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      expect(requestBody.max_results).toBe(10);
    });

    it('should use default maxResults of 5', async () => {
      const mockResponse = {
        results: [],
        answer: '',
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await service.search('test query');

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      expect(requestBody.max_results).toBe(5);
    });
  });
});

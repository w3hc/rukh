import { Test, TestingModule } from '@nestjs/testing';
import { CostTracker } from './cost-tracking.service';
import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
  },
}));

describe('CostTracker', () => {
  let service: CostTracker;
  const mockDbPath = join(process.cwd(), 'data', 'costs.json');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CostTracker],
    }).compile();

    service = module.get<CostTracker>(CostTracker);

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize successfully', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          requests: [],
          global: {
            totalInputCost: 0,
            totalOutputCost: 0,
            totalCost: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalRequests: 0,
            modelsUsage: {},
            lastUpdated: new Date().toISOString(),
          },
        }),
      );

      await service.onModuleInit();

      expect(fs.access).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File error'));

      await service.onModuleInit();

      // Service should still be defined even if initialization fails
      expect(service).toBeDefined();
    });
  });

  describe('ensureDataDirExists', () => {
    it('should create data directory if it does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(
        new Error('Directory not found'),
      );
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);

      await service.ensureDataDirExists();

      expect(fs.mkdir).toHaveBeenCalled();
    });

    it('should not create directory if it exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      await service.ensureDataDirExists();

      expect(fs.mkdir).not.toHaveBeenCalled();
    });
  });

  describe('loadData', () => {
    it('should load existing data from file', async () => {
      const mockData = {
        requests: [],
        global: {
          totalInputCost: 0,
          totalOutputCost: 0,
          totalCost: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalRequests: 0,
          modelsUsage: {},
          lastUpdated: new Date().toISOString(),
        },
      };

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockData));

      await service.loadData();

      expect(fs.readFile).toHaveBeenCalledWith(mockDbPath, 'utf-8');
    });

    it('should create new data file if it does not exist', async () => {
      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined) // data dir exists
        .mockRejectedValueOnce(new Error('File not found')); // file doesn't exist
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      await service.loadData();

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('saveData', () => {
    it('should save data to file', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      await service.saveData();

      expect(fs.writeFile).toHaveBeenCalledWith(
        mockDbPath,
        expect.any(String),
      );
    });

    it('should handle save errors', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockRejectedValue(new Error('Write error'));

      await service.saveData();

      // Should not throw, just log error
      expect(service).toBeDefined();
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens correctly', () => {
      const text = 'This is a test message';
      const tokens = service.estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });
  });

  describe('trackUsageWithTokens', () => {
    beforeEach(() => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    });

    it('should track usage with provided tokens', async () => {
      await service.trackUsageWithTokens(
        'user1',
        'test message',
        'session1',
        'claude-3-7-sonnet-20250219',
        'input text',
        'output text',
        100,
        50,
      );

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should estimate tokens if not provided', async () => {
      await service.trackUsageWithTokens(
        'user1',
        'test message',
        'session1',
        'claude-3-7-sonnet-20250219',
        'input text',
        'output text',
        0,
        0,
      );

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should use default rates for unknown model', async () => {
      await service.trackUsageWithTokens(
        'user1',
        'test message',
        'session1',
        'unknown-model',
        'input text',
        'output text',
        100,
        50,
      );

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle tracking errors', async () => {
      (fs.writeFile as jest.Mock).mockRejectedValue(new Error('Write error'));

      await service.trackUsageWithTokens(
        'user1',
        'test message',
        'session1',
        'claude-3-7-sonnet-20250219',
        'input text',
        'output text',
        100,
        50,
      );

      // Should not throw, just log error
      expect(service).toBeDefined();
    });
  });

  describe('trackUsage', () => {
    beforeEach(() => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    });

    it('should track usage with legacy method', async () => {
      await service.trackUsage(
        'user1',
        'test message',
        'session1',
        'claude-3-7-sonnet-20250219',
        'input text',
        'output text',
      );

      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('generateUsageReport', () => {
    it('should generate usage report', async () => {
      const report = await service.generateUsageReport();

      expect(report).toBeDefined();
      expect(report.requests).toBeDefined();
      expect(report.global).toBeDefined();
    });
  });
});

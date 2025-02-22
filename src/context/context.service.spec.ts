import { Test, TestingModule } from '@nestjs/testing';
import { ContextService } from './context.service';
import { join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger } from '@nestjs/common';

jest.mock('fs/promises');
jest.mock('fs');

describe('ContextService', () => {
  let service: ContextService;
  const testContextsPath = join(process.cwd(), 'data', 'contexts');
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContextService],
    }).compile();

    service = module.get<ContextService>(ContextService);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    jest.clearAllMocks();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('createContext', () => {
    it('should create a new context successfully', async () => {
      const contextName = 'test-context';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockReturnValue(false);
      (mkdir as jest.Mock).mockResolvedValue(undefined);

      const result = await service.createContext(contextName);

      expect(result).toBe(contextPath);
      expect(mkdir).toHaveBeenCalledWith(contextPath, { recursive: true });
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should throw error if context already exists', async () => {
      const contextName = 'existing-context';

      (existsSync as jest.Mock).mockReturnValue(true);

      await expect(service.createContext(contextName)).rejects.toThrow(
        `Context '${contextName}' already exists`,
      );

      expect(mkdir).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle filesystem errors', async () => {
      const contextName = 'error-context';

      (existsSync as jest.Mock).mockReturnValue(false);
      (mkdir as jest.Mock).mockRejectedValue(new Error('Filesystem error'));

      await expect(service.createContext(contextName)).rejects.toThrow(
        'Failed to create context: Filesystem error',
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Failed to create context: ${contextName}`,
        expect.any(Error),
      );
    });
  });

  describe('deleteContext', () => {
    it('should delete an existing context successfully', async () => {
      const contextName = 'test-context';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockReturnValue(true);
      (rm as jest.Mock).mockResolvedValue(undefined);

      await service.deleteContext(contextName);

      expect(rm).toHaveBeenCalledWith(contextPath, { recursive: true });
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should throw error if context does not exist', async () => {
      const contextName = 'non-existent-context';

      (existsSync as jest.Mock).mockReturnValue(false);

      await expect(service.deleteContext(contextName)).rejects.toThrow(
        `Context '${contextName}' not found`,
      );

      expect(rm).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle filesystem errors during deletion', async () => {
      const contextName = 'error-context';

      (existsSync as jest.Mock).mockReturnValue(true);
      (rm as jest.Mock).mockRejectedValue(new Error('Deletion error'));

      await expect(service.deleteContext(contextName)).rejects.toThrow(
        'Failed to delete context: Deletion error',
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Failed to delete context: ${contextName}`,
        expect.any(Error),
      );
    });
  });
});

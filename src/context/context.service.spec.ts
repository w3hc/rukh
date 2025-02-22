import { Test, TestingModule } from '@nestjs/testing';
import { ContextService } from './context.service';
import { join } from 'path';
import { mkdir, rm, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger, UnauthorizedException } from '@nestjs/common';

jest.mock('fs/promises');
jest.mock('fs');

describe('ContextService', () => {
  let service: ContextService;
  const testContextsPath = join(process.cwd(), 'data', 'contexts');
  const configPath = join(testContextsPath, 'index.json');
  let loggerErrorSpy: jest.SpyInstance;

  const mockConfig = {
    contexts: [{ name: 'existing-context', password: 'correct-password' }],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContextService],
    }).compile();

    service = module.get<ContextService>(ContextService);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    // Mock readFile for config
    (readFile as jest.Mock).mockImplementation((path) => {
      if (path === configPath) {
        return Promise.resolve(JSON.stringify(mockConfig));
      }
      return Promise.resolve('');
    });

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('createContext', () => {
    it('should create a new context with password', async () => {
      const contextName = 'new-context';
      const password = 'new-password';
      const contextPath = join(testContextsPath, contextName);

      // Setup mocks
      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      ); // Allow config to exist but not the new context
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      // Execute test
      const result = await service.createContext(contextName, password);

      // Verify results
      expect(result).toBe(contextPath);
      expect(mkdir).toHaveBeenCalledWith(contextPath, { recursive: true });

      // Verify config update - should include both existing and new context
      const expectedConfig = {
        contexts: [
          { name: 'existing-context', password: 'correct-password' },
          { name: contextName, password },
        ],
      };
      expect(writeFile).toHaveBeenCalledWith(
        configPath,
        JSON.stringify(expectedConfig, null, 2),
        'utf-8',
      );
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should throw error if context already exists', async () => {
      const contextName = 'existing-context';
      const password = 'new-password';

      (existsSync as jest.Mock).mockReturnValue(true);

      await expect(
        service.createContext(contextName, password),
      ).rejects.toThrow(`Context '${contextName}' already exists`);
      expect(mkdir).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('deleteContext', () => {
    it('should delete context with correct password', async () => {
      const contextName = 'existing-context';
      const password = 'correct-password';
      const contextPath = join(testContextsPath, contextName);

      // Setup mocks
      (existsSync as jest.Mock).mockReturnValue(true);
      (rm as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      // Execute test
      await service.deleteContext(contextName, password);

      // Verify results
      expect(rm).toHaveBeenCalledWith(contextPath, { recursive: true });

      // Verify config update - should remove only the deleted context
      const expectedConfig = { contexts: [] };
      expect(writeFile).toHaveBeenCalledWith(
        configPath,
        JSON.stringify(expectedConfig, null, 2),
        'utf-8',
      );
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException with incorrect password', async () => {
      const contextName = 'existing-context';
      const password = 'wrong-password';

      (existsSync as jest.Mock).mockReturnValue(true);

      await expect(
        service.deleteContext(contextName, password),
      ).rejects.toThrow(UnauthorizedException);
      expect(rm).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should throw error if context does not exist', async () => {
      const contextName = 'non-existent-context';
      const password = 'any-password';

      (existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        service.deleteContext(contextName, password),
      ).rejects.toThrow(`Context '${contextName}' not found`);
      expect(rm).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });
  });
});

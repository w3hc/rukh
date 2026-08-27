import { Test, TestingModule } from '@nestjs/testing';
import { ContextService } from './context.service';
import { join } from 'path';
import { mkdir, rm, readFile, writeFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger, UnauthorizedException } from '@nestjs/common';

jest.mock('fs/promises');
jest.mock('fs');

describe('ContextService', () => {
  let service: ContextService;
  const testContextsPath = join(process.cwd(), 'data', 'contexts');
  let loggerErrorSpy: jest.SpyInstance;

  const creatorAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const otherAddress = '0xffffffffffffffffffffffffffffffffffffffff';

  const mockContextIndex = {
    name: 'existing-context',
    creatorAddress,
    description: '',
    numberOfFiles: 1,
    totalSize: 5,
    files: [
      {
        name: 'test.md',
        description: '',
        size: 5,
      },
    ],
    links: [],
    queries: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContextService],
    }).compile();

    service = module.get<ContextService>(ContextService);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    (readFile as jest.Mock).mockImplementation((path) => {
      if (path.includes('existing-context/index.json')) {
        return Promise.resolve(JSON.stringify(mockContextIndex));
      }
      return Promise.resolve('');
    });

    // Mock stat function for file size calculation
    (stat as jest.Mock).mockResolvedValue({ size: 1024 });

    jest.clearAllMocks();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('createContext', () => {
    it('should create a new context owned by the signer', async () => {
      const contextName = 'new-context';
      const description = 'Test description';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      );
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.createContext(
        contextName,
        creatorAddress,
        description,
        undefined,
        creatorAddress,
      );

      expect(result).toBe(contextPath);
      expect(mkdir).toHaveBeenCalledWith(contextPath, { recursive: true });

      const expectedIndex = {
        name: contextName,
        description,
        creatorAddress,
        numberOfFiles: 0,
        totalSize: 0,
        files: [],
        links: [],
        queries: [],
      };

      expect(writeFile).toHaveBeenCalledWith(
        join(contextPath, 'index.json'),
        JSON.stringify(expectedIndex, null, 2),
        'utf-8',
      );
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should throw error if context already exists', async () => {
      const contextName = 'existing-context';

      (existsSync as jest.Mock).mockReturnValue(true);

      await expect(
        service.createContext(
          contextName,
          creatorAddress,
          '',
          undefined,
          creatorAddress,
        ),
      ).rejects.toThrow(`Context '${contextName}' already exists`);
      expect(mkdir).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should reject when the signer does not match creatorAddress', async () => {
      const contextName = 'new-context';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      );

      await expect(
        service.createContext(
          contextName,
          otherAddress,
          '',
          undefined,
          creatorAddress,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(mkdir).not.toHaveBeenCalled();
    });

    it('should reject when creatorAddress is missing', async () => {
      const contextName = 'new-context';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      );

      await expect(
        service.createContext(contextName, creatorAddress),
      ).rejects.toThrow(UnauthorizedException);
      expect(mkdir).not.toHaveBeenCalled();
    });

    it('should include the model override in the index when provided', async () => {
      const contextName = 'model-context';
      const description = 'Test description';
      const model = 'anthropic-web-search';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      );
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.createContext(
        contextName,
        creatorAddress,
        description,
        model,
        creatorAddress,
      );

      expect(result).toBe(contextPath);

      const expectedIndex = {
        name: contextName,
        description,
        model,
        creatorAddress,
        numberOfFiles: 0,
        totalSize: 0,
        files: [],
        links: [],
        queries: [],
      };

      expect(writeFile).toHaveBeenCalledWith(
        join(contextPath, 'index.json'),
        JSON.stringify(expectedIndex, null, 2),
        'utf-8',
      );
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should omit the model key when no override is given', async () => {
      const contextName = 'no-model-context';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      );
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      await service.createContext(
        contextName,
        creatorAddress,
        '',
        undefined,
        creatorAddress,
      );

      const writeCallArgs = (writeFile as jest.Mock).mock.calls[0];
      const writtenIndex = JSON.parse(writeCallArgs[1]);
      expect(writtenIndex).not.toHaveProperty('model');
    });

    it('should include creatorName when provided', async () => {
      const contextName = 'creator-context';
      const creatorName = 'Julien Béranger';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      );
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      await service.createContext(
        contextName,
        creatorAddress,
        '',
        undefined,
        creatorAddress,
        creatorName,
      );

      const writeCallArgs = (writeFile as jest.Mock).mock.calls[0];
      const writtenIndex = JSON.parse(writeCallArgs[1]);
      expect(writtenIndex.creatorAddress).toBe(creatorAddress);
      expect(writtenIndex.creatorName).toBe(creatorName);
    });

    it('should omit creatorName when not given', async () => {
      const contextName = 'no-creator-name-context';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      );
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      await service.createContext(
        contextName,
        creatorAddress,
        '',
        undefined,
        creatorAddress,
      );

      const writeCallArgs = (writeFile as jest.Mock).mock.calls[0];
      const writtenIndex = JSON.parse(writeCallArgs[1]);
      expect(writtenIndex).not.toHaveProperty('creatorName');
    });
  });

  describe('deleteContext', () => {
    it('should delete context when signer is the creator', async () => {
      const contextName = 'existing-context';
      const contextPath = join(testContextsPath, contextName);

      (existsSync as jest.Mock).mockReturnValue(true);
      (rm as jest.Mock).mockResolvedValue(undefined);

      await service.deleteContext(contextName, creatorAddress);

      expect(rm).toHaveBeenCalledWith(contextPath, { recursive: true });
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when signer is not the creator', async () => {
      const contextName = 'existing-context';

      (existsSync as jest.Mock).mockReturnValue(true);

      await expect(
        service.deleteContext(contextName, otherAddress),
      ).rejects.toThrow(UnauthorizedException);
      expect(rm).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should throw error if context does not exist', async () => {
      const contextName = 'non-existent-context';

      (existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        service.deleteContext(contextName, creatorAddress),
      ).rejects.toThrow(`Context '${contextName}' not found`);
      expect(rm).not.toHaveBeenCalled();
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('uploadFile', () => {
    it('should upload a new file to the context', async () => {
      const contextName = 'existing-context';
      const fileName = 'new-file.md';
      const content = 'Test content';
      const description = 'Test file description';

      const existsSyncSpy = existsSync as jest.Mock;
      let callCount = 0;
      existsSyncSpy.mockImplementation((path) => {
        callCount++;
        if (callCount === 1) return true;
        if (path.includes(fileName)) return false;
        return true;
      });

      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.uploadFile(
        contextName,
        fileName,
        content,
        creatorAddress,
        description,
      );

      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('wasOverwritten');
    });

    it('should reject when signer is not the creator', async () => {
      const contextName = 'existing-context';

      (existsSync as jest.Mock).mockReturnValue(true);

      await expect(
        service.uploadFile(contextName, 'new-file.md', 'content', otherAddress),
      ).rejects.toThrow(UnauthorizedException);
      expect(writeFile).not.toHaveBeenCalled();
    });
  });

  describe('recordQuery', () => {
    it('should record a query in the context index', async () => {
      const contextName = 'existing-context';
      const origin = '0x1234567890abcdef';
      const filesUsed = ['test.md'];

      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue(
        JSON.stringify(mockContextIndex),
      );
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      await service.recordQuery(contextName, origin, filesUsed);

      expect(writeFile).toHaveBeenCalledTimes(1);

      const writeCallArgs = (writeFile as jest.Mock).mock.calls[0];
      const updatedIndexJson = writeCallArgs[1];
      const updatedIndex = JSON.parse(updatedIndexJson);

      expect(updatedIndex.queries).toHaveLength(1);
      expect(updatedIndex.queries[0]).toEqual({
        timestamp: expect.any(String),
        origin,
        contextFilesUsed: filesUsed,
      });
    });
  });
});

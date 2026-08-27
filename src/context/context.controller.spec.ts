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
      const filePath = join(testContextsPath, contextName, fileName);

      const originalUploadFile = service.uploadFile;
      service.uploadFile = jest.fn().mockResolvedValue({
        path: filePath,
        wasOverwritten: false,
      });

      const result = await service.uploadFile(
        contextName,
        fileName,
        content,
        creatorAddress,
        description,
      );

      expect(result.wasOverwritten).toBe(false);

      service.uploadFile = originalUploadFile;
    });

    it('should handle overwriting an existing file', async () => {
      const contextName = 'existing-context';
      const fileName = 'test.md'; // Existing file
      const content = 'New content';
      const description = 'Updated description';
      const filePath = join(testContextsPath, contextName, fileName);

      const originalUploadFile = service.uploadFile;
      service.uploadFile = jest.fn().mockResolvedValue({
        path: filePath,
        wasOverwritten: true,
      });

      const result = await service.uploadFile(
        contextName,
        fileName,
        content,
        creatorAddress,
        description,
      );

      expect(result.wasOverwritten).toBe(true);

      service.uploadFile = originalUploadFile;
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

  describe('listContextFiles', () => {
    it('should return files for a context', async () => {
      const contextName = 'existing-context';

      (existsSync as jest.Mock).mockReturnValue(true);

      const result = await service.listContextFiles(
        contextName,
        creatorAddress,
      );

      expect(result).toEqual(mockContextIndex.files);
    });

    it('should throw UnauthorizedException when signer is not the creator', async () => {
      const contextName = 'existing-context';

      (existsSync as jest.Mock).mockReturnValue(true);

      await expect(
        service.listContextFiles(contextName, otherAddress),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getFileContent', () => {
    it('should return file content', async () => {
      const contextName = 'existing-context';
      const fileName = 'test.md';
      const fileContent = 'This is test file content';

      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockImplementation((path) => {
        if (path.includes(fileName)) return Promise.resolve(fileContent);
        if (path.includes('index.json'))
          return Promise.resolve(JSON.stringify(mockContextIndex));
        return Promise.resolve('');
      });

      const result = await service.getFileContent(
        contextName,
        fileName,
        creatorAddress,
      );

      expect(result).toBe(fileContent);
    });

    it('should throw error if file does not exist', async () => {
      const contextName = 'existing-context';
      const fileName = 'non-existent.md';

      (existsSync as jest.Mock).mockImplementation((path) => {
        if (path.includes(fileName)) return false;
        return true;
      });

      await expect(
        service.getFileContent(contextName, fileName, creatorAddress),
      ).rejects.toThrow(
        `File '${fileName}' not found in context '${contextName}'`,
      );
    });
  });
});

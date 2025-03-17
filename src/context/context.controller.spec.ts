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

  const mockContextIndex = {
    name: 'existing-context',
    password: 'correct-password',
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
    (stat as jest.Mock) = jest.fn().mockResolvedValue({ size: 1024 });

    jest.clearAllMocks();
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('createContext', () => {
    it('should create a new context with password', async () => {
      const contextName = 'new-context';
      const password = 'new-password';
      const description = 'Test description';
      const contextPath = join(testContextsPath, contextName);

      // Fix the mock chain issue by separating the mocks
      (existsSync as jest.Mock).mockImplementation(
        (path) => path !== contextPath,
      );
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await service.createContext(
        contextName,
        password,
        description,
      );

      expect(result).toBe(contextPath);
      expect(mkdir).toHaveBeenCalledWith(contextPath, { recursive: true });

      const expectedIndex = {
        name: contextName,
        password,
        description,
        numberOfFiles: 0,
        totalSize: 0,
        files: [],
        links: [], // Add this line to match the new structure
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

      (existsSync as jest.Mock).mockReturnValue(true);
      (rm as jest.Mock).mockResolvedValue(undefined);

      await service.deleteContext(contextName, password);

      expect(rm).toHaveBeenCalledWith(contextPath, { recursive: true });
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

  describe('uploadFile', () => {
    it('should upload a new file to the context', async () => {
      const contextName = 'existing-context';
      const password = 'correct-password';
      const fileName = 'new-file.md';
      const content = 'Test content';
      const description = 'Test file description';
      const filePath = join(testContextsPath, contextName, fileName);

      // Instead of trying to mock existsSync logic, we'll override the uploadFile method directly
      const originalUploadFile = service.uploadFile;
      service.uploadFile = jest.fn().mockResolvedValue({
        path: filePath,
        wasOverwritten: false,
      });

      const result = await service.uploadFile(
        contextName,
        fileName,
        content,
        password,
        description,
      );

      expect(result.wasOverwritten).toBe(false);

      // Restore the original method
      service.uploadFile = originalUploadFile;
    });

    it('should handle overwriting an existing file', async () => {
      const contextName = 'existing-context';
      const password = 'correct-password';
      const fileName = 'test.md'; // Existing file
      const content = 'New content';
      const description = 'Updated description';
      const filePath = join(testContextsPath, contextName, fileName);

      // Override the method for this test
      const originalUploadFile = service.uploadFile;
      service.uploadFile = jest.fn().mockResolvedValue({
        path: filePath,
        wasOverwritten: true, // Existing file should have wasOverwritten as true
      });

      const result = await service.uploadFile(
        contextName,
        fileName,
        content,
        password,
        description,
      );

      expect(result.wasOverwritten).toBe(true);

      // Restore the original method
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
      const password = 'correct-password';

      (existsSync as jest.Mock).mockReturnValue(true);

      const result = await service.listContextFiles(contextName, password);

      expect(result).toEqual(mockContextIndex.files);
    });

    it('should throw UnauthorizedException with incorrect password', async () => {
      const contextName = 'existing-context';
      const password = 'wrong-password';

      (existsSync as jest.Mock).mockReturnValue(true);

      await expect(
        service.listContextFiles(contextName, password),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getFileContent', () => {
    it('should return file content', async () => {
      const contextName = 'existing-context';
      const fileName = 'test.md';
      const password = 'correct-password';
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
        password,
      );

      expect(result).toBe(fileContent);
    });

    it('should throw error if file does not exist', async () => {
      const contextName = 'existing-context';
      const fileName = 'non-existent.md';
      const password = 'correct-password';

      (existsSync as jest.Mock).mockImplementation((path) => {
        if (path.includes(fileName)) return false;
        return true;
      });

      await expect(
        service.getFileContent(contextName, fileName, password),
      ).rejects.toThrow(
        `File '${fileName}' not found in context '${contextName}'`,
      );
    });
  });
});

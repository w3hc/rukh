import { Test, TestingModule } from '@nestjs/testing';
import { ContextController } from './context.controller';
import { ContextService } from './context.service';
import { HttpException } from '@nestjs/common';
import { Logger } from '@nestjs/common';

describe('ContextController', () => {
  let controller: ContextController;
  let service: ContextService;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContextController],
      providers: [
        {
          provide: ContextService,
          useValue: {
            createContext: jest.fn(),
            deleteContext: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ContextController>(ContextController);
    service = module.get<ContextService>(ContextService);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('createContext', () => {
    it('should create context successfully', async () => {
      const contextPath = '/path/to/context';
      const createContextDto = { name: 'test-context' };

      jest.spyOn(service, 'createContext').mockResolvedValue(contextPath);

      const result = await controller.createContext(createContextDto);

      expect(result).toEqual({
        message: 'Context created successfully',
        path: contextPath,
      });
      expect(service.createContext).toHaveBeenCalledWith(createContextDto.name);
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      const createContextDto = { name: 'error-context' };

      jest
        .spyOn(service, 'createContext')
        .mockRejectedValue(new Error('Service error'));

      await expect(controller.createContext(createContextDto)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('deleteContext', () => {
    it('should delete context successfully', async () => {
      const contextName = 'test-context';

      jest.spyOn(service, 'deleteContext').mockResolvedValue(undefined);

      const result = await controller.deleteContext(contextName);

      expect(result).toEqual({
        message: 'Context deleted successfully',
      });
      expect(service.deleteContext).toHaveBeenCalledWith(contextName);
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('should handle service errors', async () => {
      const contextName = 'error-context';

      jest
        .spyOn(service, 'deleteContext')
        .mockRejectedValue(new Error('Service error'));

      await expect(controller.deleteContext(contextName)).rejects.toThrow(
        HttpException,
      );
    });
  });
});

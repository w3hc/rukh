import { Test, TestingModule } from '@nestjs/testing';
import { SiweController } from './siwe.controller';
import { SiweService } from './siwe.service';
import { HttpException } from '@nestjs/common';

describe('SiweController', () => {
  let controller: SiweController;
  let service: SiweService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SiweController],
      providers: [
        {
          provide: SiweService,
          useValue: {
            generateMessage: jest.fn(),
            verifySignature: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<SiweController>(SiweController);
    service = module.get<SiweService>(SiweService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getChallenge', () => {
    it('should return a challenge message and nonce', () => {
      const mockResponse = {
        message:
          'Sign this message to authenticate with Rukh API. Nonce: test-nonce. Timestamp: 2024-01-01T00:00:00.000Z',
        nonce: 'test-nonce',
      };

      (service.generateMessage as jest.Mock).mockReturnValue(mockResponse);

      const result = controller.getChallenge();

      expect(result).toEqual(mockResponse);
      expect(service.generateMessage).toHaveBeenCalled();
    });
  });

  describe('verifySignature', () => {
    it('should throw exception if missing parameters', async () => {
      await expect(
        controller.verifySignature({
          address: '',
          signature: '0xsignature',
          nonce: 'test-nonce',
        }),
      ).rejects.toThrow(HttpException);

      await expect(
        controller.verifySignature({
          address: '0x1234567890123456789012345678901234567890',
          signature: '',
          nonce: 'test-nonce',
        }),
      ).rejects.toThrow(HttpException);

      await expect(
        controller.verifySignature({
          address: '0x1234567890123456789012345678901234567890',
          signature: '0xsignature',
          nonce: '',
        }),
      ).rejects.toThrow(HttpException);
    });

    it('should throw unauthorized exception for invalid signature', async () => {
      const verifyDto = {
        address: '0x1234567890123456789012345678901234567890',
        signature: '0xsignature',
        nonce: 'test-nonce',
      };

      (service.verifySignature as jest.Mock).mockReturnValue(false);

      await expect(controller.verifySignature(verifyDto)).rejects.toThrow(
        HttpException,
      );

      expect(service.verifySignature).toHaveBeenCalledWith(
        verifyDto.address,
        verifyDto.signature,
        verifyDto.nonce,
      );
    });

    it('should return success and address for valid signature', async () => {
      const verifyDto = {
        address: '0x1234567890123456789012345678901234567890',
        signature: '0xsignature',
        nonce: 'test-nonce',
      };

      (service.verifySignature as jest.Mock).mockReturnValue(true);

      const result = await controller.verifySignature(verifyDto);

      expect(result).toEqual({
        success: true,
        address: verifyDto.address,
      });

      expect(service.verifySignature).toHaveBeenCalledWith(
        verifyDto.address,
        verifyDto.signature,
        verifyDto.nonce,
      );
    });
  });
});

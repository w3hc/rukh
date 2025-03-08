import { Test, TestingModule } from '@nestjs/testing';
import { SiweService } from './siwe.service';
import * as ethers from 'ethers';

jest.mock('ethers', () => ({
  getAddress: jest.fn((address) => address),
  verifyMessage: jest.fn(),
}));

describe('SiweService', () => {
  let service: SiweService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SiweService],
    }).compile();

    service = module.get<SiweService>(SiweService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateMessage', () => {
    it('should generate a unique message with nonce', () => {
      const result = service.generateMessage();

      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('nonce');
      expect(result.message).toContain(
        'Sign this message to authenticate with Rukh API',
      );
      expect(result.message).toContain(`Nonce: ${result.nonce}`);
    });

    it('should store the message in internal store', () => {
      const result = service.generateMessage();

      // Access private property for testing
      const messageStore = (service as any).messageStore;
      expect(messageStore.get(result.nonce)).toBe(result.message);
    });

    it('should store nonce with expiration', () => {
      const result = service.generateMessage();

      // Access private property for testing
      const nonceStore = (service as any).nonceStore;
      const nonceData = nonceStore.get(result.nonce);

      expect(nonceData).toBeDefined();
      expect(nonceData).toHaveProperty('expiration');
      expect(nonceData).toHaveProperty('used', false);
      expect(nonceData.expiration).toBeGreaterThan(Date.now());
    });
  });

  describe('verifySignature', () => {
    it('should return false if nonce is invalid', () => {
      const result = service.verifySignature(
        '0x1234567890123456789012345678901234567890',
        '0xsignature',
        'invalid-nonce',
      );

      expect(result).toBe(false);
      expect(ethers.verifyMessage).not.toHaveBeenCalled();
    });

    it('should return false if nonce is expired', () => {
      // Generate a message to get a valid nonce
      const { nonce } = service.generateMessage();

      // Manually expire the nonce
      const nonceStore = (service as any).nonceStore;
      nonceStore.set(nonce, {
        expiration: Date.now() - 1000, // Expired
        used: false,
      });

      const result = service.verifySignature(
        '0x1234567890123456789012345678901234567890',
        '0xsignature',
        nonce,
      );

      expect(result).toBe(false);
      expect(ethers.verifyMessage).not.toHaveBeenCalled();
    });

    it('should return false if nonce has been used', () => {
      // Generate a message to get a valid nonce
      const { nonce } = service.generateMessage();

      // Mark the nonce as used
      const nonceStore = (service as any).nonceStore;
      const nonceData = nonceStore.get(nonce);
      nonceData.used = true;

      const result = service.verifySignature(
        '0x1234567890123456789012345678901234567890',
        '0xsignature',
        nonce,
      );

      expect(result).toBe(false);
      expect(ethers.verifyMessage).not.toHaveBeenCalled();
    });

    it('should return true for valid signature', () => {
      // Generate a message to get a valid nonce
      const { nonce, message } = service.generateMessage();
      const address = '0x1234567890123456789012345678901234567890';

      // Mock ethers.verifyMessage to return the expected address
      (ethers.verifyMessage as jest.Mock).mockReturnValue(address);

      const result = service.verifySignature(address, '0xsignature', nonce);

      expect(result).toBe(true);
      expect(ethers.verifyMessage).toHaveBeenCalledWith(message, '0xsignature');

      // Check if nonce is marked as used
      const nonceStore = (service as any).nonceStore;
      const nonceData = nonceStore.get(nonce);
      expect(nonceData.used).toBe(true);
    });

    it('should return false if recovered address does not match', () => {
      // Generate a message to get a valid nonce
      const { nonce, message } = service.generateMessage();
      const address = '0x1234567890123456789012345678901234567890';
      const differentAddress = '0x0987654321098765432109876543210987654321';

      // Mock ethers.verifyMessage to return a different address
      (ethers.verifyMessage as jest.Mock).mockReturnValue(differentAddress);

      const result = service.verifySignature(address, '0xsignature', nonce);

      expect(result).toBe(false);
      expect(ethers.verifyMessage).toHaveBeenCalledWith(message, '0xsignature');
    });
  });

  describe('isNonceValid', () => {
    it('should return false for non-existent nonce', () => {
      const result = (service as any).isNonceValid('non-existent-nonce');
      expect(result).toBe(false);
    });

    it('should return false for expired nonce', () => {
      // Generate a message to get a valid nonce
      const { nonce } = service.generateMessage();

      // Manually expire the nonce
      const nonceStore = (service as any).nonceStore;
      nonceStore.set(nonce, {
        expiration: Date.now() - 1000, // Expired
        used: false,
      });

      const result = (service as any).isNonceValid(nonce);
      expect(result).toBe(false);
    });

    it('should return false for used nonce', () => {
      // Generate a message to get a valid nonce
      const { nonce } = service.generateMessage();

      // Mark the nonce as used
      const nonceStore = (service as any).nonceStore;
      const nonceData = nonceStore.get(nonce);
      nonceData.used = true;

      const result = (service as any).isNonceValid(nonce);
      expect(result).toBe(false);
    });

    it('should return true for valid unused nonce', () => {
      // Generate a message to get a valid nonce
      const { nonce } = service.generateMessage();

      const result = (service as any).isNonceValid(nonce);
      expect(result).toBe(true);
    });
  });

  describe('cleanExpiredNonces', () => {
    it('should remove expired nonces', () => {
      // Generate a message to get a valid nonce
      const { nonce } = service.generateMessage();

      // Add an expired nonce
      const expiredNonce = 'expired-nonce';
      const messageStore = (service as any).messageStore;
      const nonceStore = (service as any).nonceStore;

      messageStore.set(expiredNonce, 'Test message');
      nonceStore.set(expiredNonce, {
        expiration: Date.now() - 1000, // Expired
        used: false,
      });

      // Call cleanExpiredNonces
      (service as any).cleanExpiredNonces();

      // Verify the expired nonce was removed
      expect(messageStore.has(expiredNonce)).toBe(false);
      expect(nonceStore.has(expiredNonce)).toBe(false);

      // Verify the valid nonce is still there
      expect(messageStore.has(nonce)).toBe(true);
      expect(nonceStore.has(nonce)).toBe(true);
    });
  });
});

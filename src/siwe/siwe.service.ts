import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ethers from 'ethers';

@Injectable()
export class SiweService {
  private readonly logger = new Logger(SiweService.name);
  private nonceStore: Map<string, number> = new Map(); // nonce -> expiration time
  private readonly EXPIRATION_TIME = 15 * 60 * 1000; // 15 minutes in ms

  /**
   * Generates a unique nonce
   * @returns A unique nonce
   */
  generateNonce(): string {
    const nonce = randomUUID();

    // Store nonce with expiration
    this.nonceStore.set(nonce, Date.now() + this.EXPIRATION_TIME);

    // Clean expired nonces
    this.cleanExpiredNonces();

    return nonce;
  }

  /**
   * Verifies a signature against an address
   * For testing, this always returns true.
   * In production, implement proper signature verification.
   */
  verifySignature(address: string, signature: string): boolean {
    try {
      // Ensure address is in checksummed format
      const checksummedAddress = ethers.getAddress(address);

      this.logger.debug(
        `Verifying signature for address: ${checksummedAddress}`,
      );

      return true;
    } catch (error) {
      this.logger.error(`Error verifying signature: ${error.message}`);
      return false;
    }
  }

  /**
   * Checks if a nonce exists and hasn't expired
   */
  isNonceValid(nonce: string): boolean {
    const expiresAt = this.nonceStore.get(nonce);

    if (!expiresAt) {
      return false;
    }

    if (Date.now() > expiresAt) {
      this.nonceStore.delete(nonce);
      return false;
    }

    // Delete the nonce so it can't be used again
    this.nonceStore.delete(nonce);
    return true;
  }

  /**
   * Cleans expired nonces from the store
   */
  private cleanExpiredNonces(): void {
    const now = Date.now();
    for (const [nonce, expiresAt] of this.nonceStore.entries()) {
      if (now > expiresAt) {
        this.nonceStore.delete(nonce);
      }
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ethers from 'ethers';

@Injectable()
export class SiweService {
  private readonly logger = new Logger(SiweService.name);
  private messageStore: Map<string, string> = new Map(); // nonce -> original message
  private nonceStore: Map<string, { expiration: number; used: boolean }> =
    new Map(); // nonce -> {expiration time, used status}
  private readonly EXPIRATION_TIME = 15 * 60 * 1000; // 15 minutes in ms

  /**
   * Generates a unique nonce with a message for the client to sign
   * @returns A message and nonce for the client to sign
   */
  generateMessage(): { message: string; nonce: string } {
    const nonce = randomUUID();
    const timestamp = new Date().toISOString();
    const message = `Sign this message to authenticate with Rukh API. Nonce: ${nonce}. Timestamp: ${timestamp}`;

    // Store the original message with the nonce so we can verify exactly the same message
    this.messageStore.set(nonce, message);

    // Store nonce with expiration
    this.nonceStore.set(nonce, {
      expiration: Date.now() + this.EXPIRATION_TIME,
      used: false,
    });

    // Clean expired nonces
    this.cleanExpiredNonces();

    return { message, nonce };
  }

  /**
   * Verifies a signature against an address
   * @param address The Ethereum address claimed by the user
   * @param signature The signature provided by the user
   * @param nonce The nonce previously issued to the user
   * @returns true if the signature is valid, false otherwise
   */
  verifySignature(address: string, signature: string, nonce: string): boolean {
    try {
      // First check if the nonce is valid and unused
      if (!this.isNonceValid(nonce)) {
        this.logger.warn(`Invalid or expired nonce: ${nonce}`);
        return false;
      }

      // Ensure address is in checksummed format
      const checksummedAddress = ethers.getAddress(address);

      // Get the original message that was signed
      const originalMessage = this.messageStore.get(nonce);
      if (!originalMessage) {
        this.logger.warn(`No stored message found for nonce: ${nonce}`);
        return false;
      }

      // Mark the nonce as used so it can't be reused
      const nonceData = this.nonceStore.get(nonce);
      if (nonceData) {
        nonceData.used = true;
      }

      // Recover address from signature
      const recoveredAddress = ethers.verifyMessage(originalMessage, signature);

      // Check if the recovered address matches the claimed address
      const isValid =
        recoveredAddress.toLowerCase() === checksummedAddress.toLowerCase();

      this.logger.debug(
        `Signature verification: ${isValid ? 'VALID' : 'INVALID'}`,
      );
      this.logger.debug(`- Claimed address: ${checksummedAddress}`);
      this.logger.debug(`- Recovered address: ${recoveredAddress}`);

      return isValid;
    } catch (error) {
      this.logger.error(`Error verifying signature: ${error.message}`);
      return false;
    }
  }

  /**
   * Checks if a nonce exists, hasn't expired, and hasn't been used
   */
  isNonceValid(nonce: string): boolean {
    const nonceData = this.nonceStore.get(nonce);

    if (!nonceData) {
      return false;
    }

    // Check if expired
    if (Date.now() > nonceData.expiration) {
      this.nonceStore.delete(nonce);
      this.messageStore.delete(nonce);
      return false;
    }

    // Check if already used
    if (nonceData.used) {
      return false;
    }

    return true;
  }

  /**
   * Cleans expired nonces from the store
   */
  private cleanExpiredNonces(): void {
    const now = Date.now();
    for (const [nonce, data] of this.nonceStore.entries()) {
      if (now > data.expiration) {
        this.nonceStore.delete(nonce);
        this.messageStore.delete(nonce);
      }
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { SiweController } from '../siwe/siwe.controller';

@Injectable()
export class SubsService {
  private readonly logger = new Logger(SubsService.name);

  constructor(private readonly siweController: SiweController) {}

  /**
   * Check if a user is subscribed
   * @param walletAddress The user's wallet address
   * @returns true if the user is subscribed, false otherwise
   */
  async isSubscribed(walletAddress?: string, data?: any): Promise<boolean> {
    // Always return true for now, but we'll add signature verification
    this.logger.debug(
      `Checking subscription for wallet: ${walletAddress || 'anonymous'}`,
    );

    // Skip verification if no wallet address or data
    if (!walletAddress || !data) {
      this.logger.debug('No wallet address or data provided - granting access');
      return true;
    }

    this.logger.debug(`data: ${data || 'data is empty'}`);

    try {
      // Parse data if it's a string
      let parsedData = data;
      if (typeof data === 'string') {
        try {
          parsedData = JSON.parse(data);
        } catch (error) {
          this.logger.warn(`Invalid JSON data: ${error.message}`);
          return true; // Grant access even if parsing fails
        }
      }

      // Check if signature and nonce exist in data
      const signature = parsedData?.signature;
      const nonce = parsedData?.nonce;

      if (!signature || !nonce) {
        this.logger.debug('No signature or nonce in data - granting access');
        return true;
      }

      this.logger.debug(`Verifying signature for wallet: ${walletAddress}`);

      // Call the SIWE verification
      try {
        const verifyResult = await this.siweController.verifySignature({
          address: walletAddress,
          signature: signature,
          nonce: nonce,
        });

        const isValid = verifyResult?.success === true;

        if (isValid) {
          this.logger.debug(
            `Signature verification successful for: ${walletAddress}`,
          );
        } else {
          this.logger.warn(
            `Signature verification failed for: ${walletAddress}`,
          );
        }

        return isValid;
      } catch (error) {
        this.logger.warn(`Signature verification error: ${error.message}`);
        return true; // Grant access even if verification fails for now
      }
    } catch (error) {
      this.logger.warn(`Subscription check error: ${error.message}`);
      return true; // Grant access on error
    }
  }
}

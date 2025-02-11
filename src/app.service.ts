import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { MistralService } from './mistral/mistral.service';
import { AskResponseDto } from './dto/ask-response.dto';

const RUKH_TOKEN_ABI = [
  'function mint(address to, uint256 amount) external',
  'function decimals() external view returns (uint8)',
  'function owner() external view returns (address)',
];

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private tokenContract: ethers.Contract;

  constructor(
    private readonly mistralService: MistralService,
    private readonly configService: ConfigService,
  ) {
    this.initializeWeb3();
  }

  private initializeWeb3() {
    const rpcUrl = this.configService.get<string>('ARBITRUM_RPC_URL');
    const privateKey = this.configService.get<string>('PRIVATE_KEY');
    const tokenAddress = this.configService.get<string>('RUKH_TOKEN_ADDRESS');

    if (rpcUrl && privateKey && tokenAddress) {
      try {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.signer = new ethers.Wallet(privateKey, this.provider);
        this.tokenContract = new ethers.Contract(
          tokenAddress,
          RUKH_TOKEN_ABI,
          this.signer,
        );
        this.logger.log('Web3 provider and token contract initialized');
      } catch (error) {
        this.logger.error('Failed to initialize Web3:', error);
      }
    } else {
      this.logger.warn(
        'Missing Web3 configuration. Token minting will be disabled.',
      );
    }
  }

  private async mintToken(to: string): Promise<string> {
    try {
      if (!this.tokenContract || !this.signer) {
        throw new Error('Token contract not initialized');
      }

      const decimals = await this.tokenContract.decimals();
      const amount = ethers.parseUnits('1', decimals);

      const tx = await this.tokenContract.mint(to, amount);
      this.logger.debug(`Transaction hash: ${tx.hash}`);

      return tx.hash;
    } catch (error) {
      this.logger.error('Error minting token:', error);
      return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
  }

  getHello(): string {
    return 'Hello World!';
  }

  async ask(
    message: string,
    model?: string,
    sessionId?: string,
  ): Promise<AskResponseDto> {
    let output: string | undefined;
    let usedSessionId = sessionId || uuidv4();

    if (model === 'mistral') {
      const response = await this.mistralService.processMessage(
        message,
        usedSessionId,
      );
      output = response.content;
      usedSessionId = response.sessionId;
    }

    const txHash = await this.mintToken(
      '0x990E99d9fEF9bB83E5854f3cE7E6846Dcd9e5FD5',
    );

    return {
      output,
      model: model === 'mistral' ? 'ministral-3b-2410' : 'none',
      network: 'arbitrum-sepolia',
      txHash,
      sessionId: usedSessionId,
    };
  }
}

import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { MistralService } from './mistral/mistral.service';
import { AnthropicService } from './anthropic/anthropic.service';
import { CostTracker } from './memory/cost-tracking.service';
import { AskResponseDto } from './dto/ask-response.dto';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { SubsService } from './subs/subs.service';

const RUKH_TOKEN_ABI = [
  'function mint(address to, uint256 amount) external',
  'function decimals() external view returns (uint8)',
  'function owner() external view returns (address)',
];

const DEFAULT_RECIPIENT = '0xD8a394e7d7894bDF2C57139fF17e5CBAa29Dd977';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private tokenContract: ethers.Contract;
  private contexts: Map<string, string> = new Map();

  constructor(
    private readonly mistralService: MistralService,
    private readonly anthropicService: AnthropicService,
    private readonly costTracker: CostTracker,
    private readonly configService: ConfigService,
    private readonly subsService: SubsService,
  ) {
    this.initializeWeb3();
    this.loadContexts();
  }

  private async loadContexts() {
    try {
      const contextsPath = join(process.cwd(), 'data', 'contexts');
      const indexPath = join(contextsPath, 'index.json');

      let validContexts: string[] = [];
      try {
        const indexContent = await readFile(indexPath, 'utf-8');
        const { contexts } = JSON.parse(indexContent);
        validContexts = contexts.map((ctx) => ctx.name);
      } catch (error) {
        this.logger.warn('No index.json found or invalid format');
        return;
      }

      const items = await readdir(contextsPath);
      const directories = items.filter((item) => {
        const itemPath = join(contextsPath, item);
        return validContexts.includes(item) && !item.endsWith('.json');
      });

      for (const dir of directories) {
        const contextPath = join(contextsPath, dir);
        const files = await readdir(contextPath);

        const mdFiles = files.filter((file) => file.endsWith('.md'));
        if (mdFiles.length === 0) {
          this.logger.warn(`No markdown files found in context: ${dir}`);
          continue;
        }

        let contextContent = '';
        this.logger.log(`Loading files for context '${dir}':`);
        for (const file of mdFiles) {
          this.logger.log(`- Loading file: ${file}`);
          const content = await readFile(join(contextPath, file), 'utf-8');
          contextContent += content + '\n\n';
        }

        this.contexts.set(dir, contextContent.trim());
        this.logger.log(
          `Successfully loaded context: ${dir} with ${mdFiles.length} files`,
        );
      }

      if (this.contexts.size === 0) {
        this.logger.warn('No valid contexts were loaded');
      } else {
        this.logger.log(`Successfully loaded ${this.contexts.size} contexts`);
      }
    } catch (error) {
      this.logger.error('Failed to load contexts:', error);
    }
  }

  private initializeWeb3() {
    const rpcUrl = this.configService.get<string>('ARBITRUM_RPC_URL');
    const privateKey = this.configService.get<string>('PRIVATE_KEY');
    const tokenAddress = this.configService.get<string>('RUKH_TOKEN_ADDRESS');

    if (rpcUrl && privateKey && tokenAddress) {
      try {
        // Use a more reliable public RPC endpoint as fallback
        const fallbackRpcUrls = [
          rpcUrl,
          'https://arb-sepolia.g.alchemy.com/v2/demo', // Alchemy public endpoint
          'https://arbitrum-sepolia.blockpi.network/v1/rpc/public', // BlockPI public endpoint
          'https://sepolia-rollup.arbitrum.io/rpc', // Arbitrum official endpoint
        ];

        // Try to create provider with first RPC URL
        this.provider = new ethers.JsonRpcProvider(fallbackRpcUrls[0]);

        // Test provider connection
        this.provider.getBlockNumber().catch(async (error) => {
          this.logger.warn(`Primary RPC connection failed: ${error.message}`);

          // Try fallback RPC URLs if primary fails
          for (let i = 1; i < fallbackRpcUrls.length; i++) {
            try {
              this.logger.log(`Trying fallback RPC URL #${i}...`);
              const fallbackProvider = new ethers.JsonRpcProvider(
                fallbackRpcUrls[i],
              );
              await fallbackProvider.getBlockNumber(); // Test connection

              this.provider = fallbackProvider;
              this.signer = new ethers.Wallet(privateKey, this.provider);
              this.tokenContract = new ethers.Contract(
                tokenAddress,
                RUKH_TOKEN_ABI,
                this.signer,
              );

              this.logger.log(`Connected to fallback RPC #${i} successfully`);
              break;
            } catch (fallbackError) {
              this.logger.warn(
                `Fallback RPC #${i} connection failed: ${fallbackError.message}`,
              );
            }
          }
        });

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
        this.logger.warn(
          'Token contract not initialized, returning dummy tx hash',
        );
        return '0x0000000000000000000000000000000000000000000000000000000000000000';
      }

      // Validate that the provider is connected
      try {
        const blockNumber = await this.provider.getBlockNumber();
        this.logger.debug(`Current block number: ${blockNumber}`);
      } catch (error) {
        this.logger.error(
          'Provider connection failed, returning dummy tx hash:',
          error,
        );
        return '0x0000000000000000000000000000000000000000000000000000000000000000';
      }

      const amount = ethers.parseUnits('1');

      try {
        // Ensure we're the owner
        const owner = await this.tokenContract.owner();
        if (owner.toLowerCase() !== this.signer.address.toLowerCase()) {
          this.logger.warn(
            `Signer address (${this.signer.address}) is not the contract owner (${owner})`,
          );
        }
      } catch (error) {
        this.logger.warn('Could not verify contract ownership:', error);
      }

      // Set a moderate gas price to avoid transaction failures
      const gasPrice = await this.provider
        .getFeeData()
        .then((feeData) => feeData.gasPrice)
        .catch(() => ethers.parseUnits('1', 'gwei')); // Default if we can't get fee data

      // Send with explicit gas settings
      const tx = await this.tokenContract.mint(to, amount, {
        gasLimit: 150000, // Explicit gas limit
        gasPrice: gasPrice,
      });

      this.logger.debug(`Transaction hash: ${tx.hash}`);

      return tx.hash;
    } catch (error) {
      this.logger.error('Error minting token:', error);

      // RPC errors should be handled gracefully
      if (error.code === 'NETWORK_ERROR' || error.code === 'UNKNOWN_ERROR') {
        this.logger.warn('Network error encountered, returning dummy tx hash');
      }

      return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
  }

  async ask(
    message: string,
    model?: string,
    sessionId?: string,
    walletAddress?: string,
    context: string = 'rukh',
    file?: Express.Multer.File,
    data?: Record<string, any>,
  ): Promise<AskResponseDto> {
    let output: string | undefined;
    let usedSessionId = sessionId || uuidv4();
    let usedModel = 'none';
    let fullInput = '';
    let fullOutput = '';
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
    };

    const selectedModel = model || 'mistral';

    // Check subscription status
    try {
      // This is the key change - add more debug info and handle any errors
      this.logger.debug(
        `Checking subscription for ${walletAddress || 'anonymous'} with data: ${JSON.stringify(data || {})}`,
      );

      const isSubscribed = await this.subsService.isSubscribed(
        walletAddress,
        data,
      );

      if (!isSubscribed) {
        this.logger.warn(
          `Access denied for wallet: ${walletAddress || 'anonymous'} - No subscription`,
        );
        throw new HttpException(
          'Subscription required to access this service',
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // Re-throw if it's already a proper HTTP exception
      }

      // Log the error but don't block access during development
      this.logger.error(`Error checking subscription: ${error.message}`);

      // In production, you might want to throw an error here
      if (process.env.NODE_ENV === 'production') {
        throw new HttpException(
          'Error verifying subscription',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // In development, log warning but continue
      this.logger.warn(
        'Continuing despite subscription verification error (development mode)',
      );
    }

    return;

    try {
      const contextContent = this.contexts.get(context);

      let fileContent = '';
      if (file && file.originalname.toLowerCase().endsWith('.md')) {
        fileContent = `\n\nUploaded file (${file.originalname}):\n${file.buffer.toString('utf-8')}`;
        this.logger.log(
          `Processing uploaded file: ${file.originalname} (${file.size} bytes)`,
        );
      } else if (file) {
        this.logger.warn(`Ignoring non-markdown file: ${file.originalname}`);
      }

      if (selectedModel === 'mistral') {
        const { isFirstMessage } =
          await this.mistralService.getConversationHistory(usedSessionId);

        const contextualMessage =
          isFirstMessage && contextContent
            ? `Context: ${contextContent}\n\nUser Query: ${message}${fileContent}`
            : `${message}${fileContent}`;

        // Save full input for cost tracking
        fullInput = contextualMessage;

        const response = await this.mistralService.processMessage(
          contextualMessage,
          usedSessionId,
        );
        output = response.content;
        fullOutput = response.content;
        usedSessionId = response.sessionId;
        usedModel = 'ministral-3b-2410';

        // Make sure we have valid usage data
        usage = response.usage || {
          input_tokens: Math.ceil(fullInput.length / 4), // Estimate if not provided
          output_tokens: Math.ceil(fullOutput.length / 4),
        };
      } else if (selectedModel === 'anthropic') {
        const { isFirstMessage } =
          await this.anthropicService.getConversationHistory(usedSessionId);

        const contextualMessage =
          isFirstMessage && contextContent
            ? `Context: ${contextContent}\n\nUser Query: ${message}${fileContent}`
            : `${message}${fileContent}`;

        // Save full input for cost tracking
        fullInput = contextualMessage;

        const response = await this.anthropicService.processMessage(
          contextualMessage,
          usedSessionId,
        );
        output = response.content;
        fullOutput = response.content;
        usedSessionId = response.sessionId;
        usedModel = 'claude-3-7-sonnet-20250219';

        // Make sure we have valid usage data
        usage = response.usage || {
          input_tokens: Math.ceil(fullInput.length / 4), // Estimate if not provided
          output_tokens: Math.ceil(fullOutput.length / 4),
        };
      }

      // STEP 1: Track usage for all successful responses regardless of wallet
      // We'll do this even if there's no wallet, using DEFAULT_RECIPIENT as the tracker
      if (output) {
        const trackingWallet =
          walletAddress && walletAddress.trim() !== ''
            ? walletAddress
            : DEFAULT_RECIPIENT;

        this.logger.debug(
          `Tracking usage for ${trackingWallet} with model ${usedModel}`,
        );
        this.logger.debug(
          `Token usage: input=${usage.input_tokens}, output=${usage.output_tokens}`,
        );

        try {
          await this.costTracker.trackUsageWithTokens(
            trackingWallet,
            message,
            usedSessionId,
            usedModel,
            fullInput,
            fullOutput,
            usage.input_tokens,
            usage.output_tokens,
          );
          this.logger.debug('Usage tracking completed successfully');
        } catch (error) {
          this.logger.error('Failed to track usage:', error);
        }
      } else {
        this.logger.warn('Skipping usage tracking - no output was generated');
      }

      // STEP 2: Only after tracking is complete, mint tokens
      const recipient =
        walletAddress && walletAddress.trim() !== ''
          ? walletAddress
          : DEFAULT_RECIPIENT;

      this.logger.debug(`Minting token reward to ${recipient}`);
      const txHash = await this.mintToken(recipient);
      this.logger.debug(`Token minting completed with tx hash: ${txHash}`);

      return {
        output,
        model: usedModel,
        network: 'arbitrum-sepolia',
        txHash,
        explorerLink: `https://sepolia.arbiscan.io/tx/${txHash}`,
        sessionId: usedSessionId,
        usage: usage, // Include token usage in response
      };
    } catch (error) {
      this.logger.error(
        `Error processing message with ${selectedModel}:`,
        error,
      );

      // Still return a response with available information
      const recipient =
        walletAddress && walletAddress.trim() !== ''
          ? walletAddress
          : DEFAULT_RECIPIENT;

      const txHash = await this.mintToken(recipient);

      return {
        output,
        model: usedModel,
        network: 'arbitrum-sepolia',
        txHash,
        explorerLink: `https://sepolia.arbiscan.io/tx/${txHash}`,
        sessionId: usedSessionId,
        usage: usage,
      };
    }
  }

  getHello(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Rukh</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            background-color: #1a1a1a;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        .container {
            text-align: center;
            padding: 2rem;
            max-width: 800px;
        }

        h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            background: linear-gradient(45deg, #3490dc, #6574cd);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }

        p {
            font-size: 1.2rem;
            line-height: 1.6;
            color: #a0aec0;
            margin: 1rem 0;
        }

        .tech-links {
            margin: 1rem 0;
            font-size: 1.2rem;
            line-height: 1.6;
            color: #a0aec0;
        }

        .tech-links a {
            background: linear-gradient(45deg, #3490dc, #6574cd);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            text-decoration: none;
            transition: opacity 0.2s;
        }

        .tech-links a:hover {
            opacity: 0.8;
        }

        .links {
            margin-top: 2rem;
        }

        .button {
            display: inline-block;
            padding: 0.8rem 1.6rem;
            margin: 0.5rem;
            background: linear-gradient(45deg, #3490dc, #6574cd);
            color: white;
            text-decoration: none;
            border-radius: 5px;
            transition: transform 0.2s;
        }

        .button:hover {
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome to Rukh!</h1>
        <p>A lightweight, developer-friendly toolkit for building AI agents with Web3 integration</p>
        <p>🚀 Quick setup • 🔄 Built-in session management • 🔗 Web3 integration • 🛠️ Modular architecture for easy LLM integration (Mistral, Anthropic, OpenAI, DeepSeek, etc.)</p>
        <div class="links">
            <a href="/api" class="button">Swagger UI</a>
            <a href="https://github.com/w3hc/rukh" target="_blank" rel="noopener noreferrer" class="button">GitHub Repo</a>
        </div>
        <br />
        <img src="https://bafkreid5xwxz4bed67bxb2wjmwsec4uhlcjviwy7pkzwoyu5oesjd3sp64.ipfs.w3s.link" alt="built-with-ethereum-w3hc" width="150"/>
    </div>
</body>
</html>`;
  }
}

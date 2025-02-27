import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { MistralService } from './mistral/mistral.service';
import { AskResponseDto } from './dto/ask-response.dto';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

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
    private readonly configService: ConfigService,
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

      const amount = ethers.parseUnits('1');

      const tx = await this.tokenContract.mint(to, amount);
      this.logger.debug(`Transaction hash: ${tx.hash}`);

      return tx.hash;
    } catch (error) {
      this.logger.error('Error minting token:', error);
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
  ): Promise<AskResponseDto> {
    let output: string | undefined;
    let usedSessionId = sessionId || uuidv4();

    try {
      const { isFirstMessage } =
        await this.mistralService.getConversationHistory(usedSessionId);

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

      const contextualMessage =
        isFirstMessage && contextContent
          ? `Context: ${contextContent}\n\nUser Query: ${message}${fileContent}`
          : `${message}${fileContent}`;

      const response = await this.mistralService.processMessage(
        contextualMessage,
        usedSessionId,
      );
      output = response.content;
      usedSessionId = response.sessionId;
    } catch (error) {
      this.logger.error('Error processing message with Mistral:', error);
    }

    const recipient =
      walletAddress && walletAddress.trim() !== ''
        ? walletAddress
        : DEFAULT_RECIPIENT;

    const txHash = await this.mintToken(recipient);
    const explorerLink = `https://sepolia.arbiscan.io/tx/${txHash}`;

    return {
      output,
      model: 'ministral-3b-2410',
      network: 'arbitrum-sepolia',
      txHash,
      explorerLink,
      sessionId: usedSessionId,
    };
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

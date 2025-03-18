import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { MistralService } from './mistral/mistral.service';
import { AnthropicService } from './anthropic/anthropic.service';
import { CostTracker } from './memory/cost-tracking.service';
import { AskResponseDto } from './dto/ask-response.dto';
import { readFile, readdir, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { SubsService } from './subs/subs.service';
import { existsSync } from 'fs';
import { ContextService } from './context/context.service';
import { WebReaderService } from './web/web-reader.service';

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
    private readonly contextService: ContextService,
    private readonly webReaderService: WebReaderService,
  ) {
    this.initializeWeb3();
    this.loadContexts();
  }

  private async loadContexts() {
    try {
      const contextsPath = join(process.cwd(), 'data', 'contexts');

      // Create contexts directory if it doesn't exist
      if (!existsSync(contextsPath)) {
        this.logger.log('Creating contexts directory');
        await mkdir(contextsPath, { recursive: true });
        return;
      }

      // Get the list of context directories
      const items = await readdir(contextsPath);
      const directories = [];

      for (const item of items) {
        const itemPath = join(contextsPath, item);
        if (existsSync(itemPath) && (await this.isDirectory(itemPath))) {
          directories.push(item);
        }
      }

      if (directories.length === 0) {
        this.logger.warn('No context directories found');
        return;
      }

      // Process each context directory
      for (const dir of directories) {
        const contextPath = join(contextsPath, dir);
        const indexPath = join(contextPath, 'index.json');

        // Skip directories without an index.json file
        if (!existsSync(indexPath)) {
          this.logger.warn(`Skipping directory ${dir}: No index.json found`);
          continue;
        }

        // Read and process the context files
        try {
          const files = await readdir(contextPath);
          const mdFiles = files.filter(
            (file) => file.endsWith('.md') && file !== 'README.md',
          );

          if (mdFiles.length === 0) {
            this.logger.warn(`No markdown files found in context: ${dir}`);
            continue;
          }

          let contextContent = '';
          this.logger.log(`Loading files for context '${dir}':`);

          for (const file of mdFiles) {
            this.logger.log(`- Loading file: ${file}`);
            const content = await readFile(join(contextPath, file), 'utf-8');
            contextContent += `\n\n# File: ${file}\n\n${content}`;
          }

          this.contexts.set(dir, contextContent.trim());
          this.logger.log(
            `Successfully loaded context: ${dir} with ${mdFiles.length} files`,
          );
        } catch (error) {
          this.logger.error(`Error processing context ${dir}:`, error);
        }
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

  private async isDirectory(path: string): Promise<boolean> {
    try {
      const stats = await stat(path);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  async processContextData(
    contextName: string,
    walletAddress?: string,
    message?: string,
  ): Promise<string> {
    try {
      // Skip if no context is specified
      if (!contextName || contextName === '') {
        return '';
      }

      const contextPath = join(process.cwd(), 'data', 'contexts', contextName);

      // Check if the context exists
      if (!existsSync(contextPath)) {
        this.logger.warn(`Context ${contextName} not found`);
        return `Context '${contextName}' not found.`;
      }

      // First, try to get the context index to check for links
      const indexPath = join(contextPath, 'index.json');
      let contextIndex = null;

      if (existsSync(indexPath)) {
        try {
          const indexData = await readFile(indexPath, 'utf-8');
          contextIndex = JSON.parse(indexData);
        } catch (error) {
          this.logger.error(`Error reading context index: ${error.message}`);
        }
      }

      // Get list of markdown files in the context directly from disk
      const files = await this.getMarkdownFiles(contextPath);

      // Track which files and links are used for this query
      const usedFiles: string[] = [];

      // Read and concatenate all markdown files directly from disk
      let contextContent = '';

      this.logger.log(`Loading files for context '${contextName}':`);
      for (const file of files) {
        try {
          const filePath = join(contextPath, file);
          this.logger.log(`- Loading file: ${file}`);
          const content = await readFile(filePath, 'utf-8');
          contextContent += `\n\n### Context File: ${file}\n${content}`;
          usedFiles.push(file);
        } catch (error) {
          this.logger.error(`Error reading file ${file}: ${error.message}`);
          // Continue with other files
        }
      }

      // Process links if they exist in the context index
      if (contextIndex && contextIndex.links && contextIndex.links.length > 0) {
        this.logger.log(
          `Processing ${contextIndex.links.length} links for context '${contextName}'`,
        );

        for (const link of contextIndex.links) {
          try {
            this.logger.log(`Fetching content from link: ${link.url}`);

            // Use WebReaderService to extract content from the link
            const extractedContent = await this.webReaderService.extractForLLM(
              link.url,
            );

            // Add the extracted content to the context
            contextContent += `\n\n### Context Link: ${link.title} (${link.url})\n${extractedContent.text}`;

            // Track the link usage
            usedFiles.push(`link:${link.url}`);
          } catch (error) {
            this.logger.error(
              `Error processing link ${link.url}: ${error.message}`,
            );
            // Continue with other links
          }
        }
      }

      if (usedFiles.length > 0) {
        try {
          await this.recordContextQuery(
            contextName,
            walletAddress,
            usedFiles,
            message,
          );
        } catch (error) {
          // Non-critical operation, just log the error
          this.logger.warn(`Failed to record context query: ${error.message}`);
        }
      }

      this.logger.log(
        `Successfully loaded ${usedFiles.length} items from context: ${contextName}`,
      );
      return contextContent.trim();
    } catch (error) {
      this.logger.error(`Error processing context data: ${error.message}`);
      return `Error processing context data: ${error.message}`;
    }
  }

  private async recordContextQuery(
    contextName: string,
    walletAddress: string,
    filesUsed: string[],
    message: string,
  ): Promise<void> {
    const indexPath = join(
      process.cwd(),
      'data',
      'contexts',
      contextName,
      'index.json',
    );

    if (!existsSync(indexPath)) {
      throw new Error(`Context index file not found for ${contextName}`);
    }

    try {
      // Read the current index
      const indexData = await readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexData);

      // Add the query
      if (!index.queries) {
        index.queries = [];
      }

      // Use "anon" as default value when walletAddress is empty
      const origin =
        walletAddress && walletAddress.trim() !== '' ? walletAddress : 'anon';

      index.queries.push({
        timestamp: new Date().toISOString(),
        origin: origin,
        message: message,
        contextFilesUsed: filesUsed,
      });

      // Write back the updated index
      await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to record context query: ${error.message}`);
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

  /**
   * Loads context information to be used as system prompt
   * @param contextName The name of the context to load
   * @param origin The origin (usually wallet address) for tracking context usage
   * @param userMessage The original user message for tracking
   * @returns Formatted context information for use in system prompt
   */
  private async loadContextInformation(
    contextName: string,
    origin: string,
    userMessage: string = '', // Add user message parameter with default empty value
  ): Promise<string> {
    try {
      // Skip if no context is specified
      if (!contextName || contextName === '') {
        return '';
      }

      const contextPath = join(process.cwd(), 'data', 'contexts', contextName);

      // Check if the context exists
      if (!existsSync(contextPath)) {
        this.logger.warn(`Context ${contextName} not found`);
        return '';
      }

      // First, try to get the context index to check for links and password
      const indexPath = join(contextPath, 'index.json');
      let contextIndex = null;
      let contextPassword = '';

      if (existsSync(indexPath)) {
        try {
          const indexData = await readFile(indexPath, 'utf-8');
          contextIndex = JSON.parse(indexData);

          // If we have a context index with password, store it for future use
          if (contextIndex && contextIndex.password) {
            contextPassword = contextIndex.password;
            this.contexts.set(contextName, contextPassword);
          }
        } catch (error) {
          this.logger.error(`Error reading context index: ${error.message}`);
        }
      }

      // If we still don't have a password, check if we have it stored already
      if (!contextPassword && this.contexts.has(contextName)) {
        contextPassword = this.contexts.get(contextName);
      }

      // Get list of markdown files in the context
      let files: string[] = [];
      try {
        if (contextPassword) {
          // If we have a password, try to use the ContextService
          const contextFiles = await this.contextService.listContextFiles(
            contextName,
            contextPassword,
          );
          files = contextFiles.map((file) => file.name);
        } else {
          // Fallback to direct file system access
          files = await this.getMarkdownFiles(contextPath);
        }
      } catch (error) {
        this.logger.error(`Error listing context files: ${error.message}`);
        // Fallback to direct file system access
        files = await this.getMarkdownFiles(contextPath);
      }

      // Track which files and links are used for this query
      const usedFiles: string[] = [];

      // Build context content for system prompt
      let contextContent = `# Context: ${contextName}\n\n`;

      // Read and add content from all markdown files
      if (files && files.length > 0) {
        this.logger.log(
          `Loading ${files.length} files for context '${contextName}':`,
        );
        contextContent += `## Context Files\n\n`;

        for (const file of files) {
          try {
            let fileContent = '';

            if (contextPassword) {
              // Try to get file content using ContextService
              fileContent = await this.contextService.getFileContent(
                contextName,
                file,
                contextPassword,
              );
            } else {
              // Fallback to direct file system access
              const filePath = join(contextPath, file);
              fileContent = await readFile(filePath, 'utf-8');
            }

            contextContent += `### File: ${file}\n${fileContent}\n\n`;
            usedFiles.push(file);
            this.logger.debug(`- Added file: ${file}`);
          } catch (error) {
            this.logger.error(`Error reading file ${file}: ${error.message}`);
            // Continue with other files
          }
        }
      }

      // Process links if they exist in the context index
      if (contextIndex && contextIndex.links && contextIndex.links.length > 0) {
        const links = contextIndex.links;
        this.logger.log(
          `Processing ${links.length} links for context '${contextName}'`,
        );
        contextContent += `## Context Links\n\n`;

        for (const link of links) {
          try {
            this.logger.debug(`- Fetching content from link: ${link.url}`);

            // Use WebReaderService to extract content from the link
            const extractedContent = await this.webReaderService.extractForLLM(
              link.url,
            );

            // Add the extracted content to the context
            contextContent += `### Link: ${link.title} (${link.url})\n${extractedContent.text}\n\n`;

            // Track the link usage
            usedFiles.push(`link:${link.url}`);
          } catch (error) {
            this.logger.error(
              `Error processing link ${link.url}: ${error.message}`,
            );
            // Add a fallback note about the link
            contextContent += `### Link: ${link.title} (${link.url})\nCould not fetch content from this link.\n\n`;
            usedFiles.push(`link:${link.url}`);
          }
        }
      }

      // Record the context query for analytics purposes
      if (usedFiles.length > 0) {
        try {
          await this.recordContextQuery(
            contextName,
            origin,
            usedFiles,
            userMessage, // Use the actual user message instead of static text
          );
          this.logger.debug(
            `Recorded context usage of ${usedFiles.length} files/links for message: "${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}"`,
          );
        } catch (error) {
          // Non-critical operation, just log the error
          this.logger.warn(`Failed to record context query: ${error.message}`);
        }
      }

      this.logger.log(
        `Generated system prompt from context: ${contextName} (${contextContent.length} characters, ${usedFiles.length} items)`,
      );
      return contextContent.trim();
    } catch (error) {
      this.logger.error(
        `Error generating system prompt from context: ${error.message}`,
      );
      return '';
    }
  }

  /**
   * Gets a list of markdown files in the given directory
   * @param directoryPath Path to directory containing markdown files
   * @returns Array of markdown filenames
   */
  private async getMarkdownFiles(directoryPath: string): Promise<string[]> {
    try {
      const files = await readdir(directoryPath);
      return files.filter(
        (file) =>
          file.toLowerCase().endsWith('.md') &&
          file !== 'README.md' &&
          file !== 'index.json',
      );
    } catch (error) {
      this.logger.error(`Error reading directory: ${error.message}`);
      return [];
    }
  }

  async ask(
    message: string,
    model?: string,
    sessionId?: string,
    walletAddress?: string,
    contextName: string = 'rukh',
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

    // Define available models for fallback
    const availableModels = ['mistral', 'anthropic'];

    // Initialize with the selected model, or default to anthropic
    let selectedModel = model || 'anthropic';

    // Validate the model and prepare fallback sequence
    if (!availableModels.includes(selectedModel)) {
      this.logger.warn(
        `Invalid model specified: ${selectedModel}, defaulting to mistral`,
      );
      selectedModel = 'mistral';
    }

    // Create a fallback sequence starting with the selected model
    const modelsToTry = [
      selectedModel,
      ...availableModels.filter((m) => m !== selectedModel),
    ];

    this.logger.log(
      `Processing request with models in fallback sequence: ${modelsToTry.join(', ')}`,
    );

    try {
      // Check Zhankai subscription status if applicable
      if (contextName && contextName.toLowerCase() === 'zhankai') {
        this.logger.debug(
          `Zhankai context detected - checking usage for ${walletAddress || 'anonymous'}`,
        );

        // Skip subscription check if wallet address is undefined
        if (!walletAddress) {
          this.logger.debug(
            `Anonymous user - proceeding without subscription check`,
          );
        } else {
          const zhankaiPath = join(
            process.cwd(),
            'data',
            'contexts',
            'zhankai',
          );
          const indexPath = join(zhankaiPath, 'index.json');

          // Check if zhankai context exists
          if (existsSync(indexPath)) {
            try {
              const indexData = await readFile(indexPath, 'utf-8');
              const contextIndex = JSON.parse(indexData);

              // Count queries from this wallet address
              const walletQueries =
                contextIndex.queries?.filter(
                  (query) =>
                    query.origin?.toLowerCase() === walletAddress.toLowerCase(),
                ) || [];

              const queryCount = walletQueries.length;

              this.logger.debug(
                `User ${walletAddress} has used ${queryCount} queries for Zhankai context`,
              );

              // If user has used 3 or more queries, verify subscription
              if (queryCount >= 3) {
                this.logger.debug(
                  `Free query limit reached - checking subscription status`,
                );

                const isSubscribed = await this.subsService.isSubscribed(
                  walletAddress,
                  data,
                );

                if (!isSubscribed) {
                  this.logger.warn(
                    `Access denied for wallet: ${walletAddress} - No subscription for Zhankai context after free queries`,
                  );
                  throw new HttpException(
                    'Free query limit reached. Subscription required to continue using the Zhankai context.',
                    HttpStatus.PAYMENT_REQUIRED,
                  );
                }

                this.logger.debug(
                  `Subscription verified for Zhankai context access`,
                );
              } else {
                this.logger.debug(
                  `User has ${3 - queryCount} free queries remaining`,
                );
              }
            } catch (error) {
              this.logger.error(
                `Error checking Zhankai context queries: ${error.message}`,
              );
              // Continue with processing despite error
            }
          } else {
            this.logger.debug(`Zhankai context index not found`);
          }
        }
      } else {
        this.logger.debug(
          `Skipping subscription check - not using Zhankai context`,
        );
      }

      // Initialize a system prompt to contain context information
      let systemPrompt = '';

      // Load context information if context is specified
      if (contextName && contextName !== '') {
        this.logger.log(`Loading context information: ${contextName}`);
        systemPrompt = await this.loadContextInformation(
          contextName,
          walletAddress || 'anonymous',
          message, // Pass the original user message
        );
        this.logger.debug(
          `Generated system prompt with context information (${systemPrompt.length} characters)`,
        );
      }

      // Handle file upload if present
      if (file && file.originalname.toLowerCase().endsWith('.md')) {
        const fileContent = file.buffer.toString('utf-8');
        this.logger.log(
          `Processing uploaded file: ${file.originalname} (${file.size} bytes)`,
        );

        // Add file content to system prompt
        if (systemPrompt) {
          systemPrompt += '\n\n';
        }
        systemPrompt += `Uploaded file (${file.originalname}):\n${fileContent}`;
      } else if (file) {
        this.logger.warn(`Ignoring non-markdown file: ${file.originalname}`);
      }

      // Store full input for cost tracking (combining system prompt and user message)
      fullInput = systemPrompt ? systemPrompt + '\n\n' + message : message;

      // Try each model in the fallback sequence
      let lastError: Error | null = null;
      let modelProcessed = false;

      for (const currentModel of modelsToTry) {
        if (modelProcessed) {
          break; // Skip if we already have a successful response
        }

        try {
          this.logger.log(`Attempting to process with model: ${currentModel}`);

          // Process the message with the current model
          switch (currentModel) {
            case 'mistral': {
              // Check if there's existing conversation
              const { isFirstMessage } =
                await this.mistralService.getConversationHistory(usedSessionId);

              // Only use system prompt for first message or if no history is available
              const effectiveSystemPrompt = isFirstMessage
                ? systemPrompt
                : undefined;

              this.logger.debug(
                `Using ${effectiveSystemPrompt ? 'system prompt' : 'no system prompt'} with Mistral`,
              );

              const response = await this.mistralService.processMessage(
                message, // Send the clean message without context
                usedSessionId,
                effectiveSystemPrompt,
              );

              output = response.content;
              fullOutput = response.content;
              usedSessionId = response.sessionId;
              usedModel = 'mistral-large-2411';

              // Make sure we have valid usage data
              usage = response.usage || {
                input_tokens: Math.ceil(fullInput.length / 4), // Estimate if not provided
                output_tokens: Math.ceil(fullOutput.length / 4),
              };

              modelProcessed = true;
              this.logger.log(`Successfully processed with Mistral model`);
              break;
            }

            case 'anthropic': {
              // Check if there's existing conversation
              const { isFirstMessage } =
                await this.anthropicService.getConversationHistory(
                  usedSessionId,
                );

              // Only use system prompt for first message or if no history is available
              const effectiveSystemPrompt = isFirstMessage
                ? systemPrompt
                : undefined;

              this.logger.debug(
                `Using ${effectiveSystemPrompt ? 'system prompt' : 'no system prompt'} with Anthropic`,
              );

              const response = await this.anthropicService.processMessage(
                message, // Send the clean message without context
                usedSessionId,
                effectiveSystemPrompt,
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

              modelProcessed = true;
              this.logger.log(`Successfully processed with Anthropic model`);
              break;
            }

            default: {
              this.logger.warn(`Unsupported model: ${currentModel}, skipping`);
              break;
            }
          }
        } catch (error) {
          this.logger.error(
            `Error processing with model ${currentModel}: ${error.message}`,
          );
          lastError = error as Error;
          this.logger.log(`Falling back to next model in sequence...`);
        }
      }

      // If all models failed, log the last error
      if (!modelProcessed && lastError) {
        this.logger.error(
          `All models in fallback sequence failed. Last error: ${lastError.message}`,
        );
      }

      // STEP 1: Track usage for all successful responses regardless of wallet
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
            fullInput, // Full input includes both system prompt and user message
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
      this.logger.error(`Error in overall request processing:`, error);

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

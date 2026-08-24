import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MistralService } from './mistral/mistral.service';
import { AnthropicService } from './anthropic/anthropic.service';
import { OpenAIService } from './openai/openai.service';
import { CostTracker } from './memory/cost-tracking.service';
import { AskDto } from './dto/ask.dto';
import { AskResponseDto } from './dto/ask-response.dto';
import { readFile, readdir, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { SubsService } from './subs/subs.service';
import { existsSync } from 'fs';
import { ContextService } from './context/context.service';
import { WebReaderService } from './web/web-reader.service';
import { RagService } from './rag/rag.service';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  // Maximum number of files/URLs the two-step RAG selection step may pick
  private readonly RAG_MAX_FILES = 5;
  private contexts: Map<string, string> = new Map();
  private writeQueue: Map<string, Promise<void>> = new Map();

  constructor(
    private readonly mistralService: MistralService,
    private readonly anthropicService: AnthropicService,
    private readonly openaiService: OpenAIService,
    private readonly costTracker: CostTracker,
    private readonly subsService: SubsService,
    private readonly contextService: ContextService,
    private readonly webReaderService: WebReaderService,
    private readonly ragService: RagService,
  ) {
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
          // Only log as error if it's not a file-not-found error
          if (
            error instanceof Error &&
            'code' in error &&
            (error as any).code === 'ENOENT'
          ) {
            this.logger.warn(
              `Context ${dir} directory exists but file not found, skipping`,
            );
          } else {
            this.logger.error(`Error processing context ${dir}:`, error);
          }
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
    } catch {
      return false;
    }
  }

  async processContextData(
    contextName: string,
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
          this.logger.error(
            `Error reading context index: ${error instanceof Error ? error.message : String(error)}`,
          );
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
          this.logger.error(
            `Error reading file ${file}: ${error instanceof Error ? error.message : String(error)}`,
          );
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
              `Error processing link ${link.url}: ${error instanceof Error ? error.message : String(error)}`,
            );
            // Continue with other links
          }
        }
      }

      if (usedFiles.length > 0) {
        try {
          await this.recordContextQuery(contextName, usedFiles, message);
        } catch (error) {
          // Non-critical operation, just log the error
          this.logger.warn(
            `Failed to record context query: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.log(
        `Successfully loaded ${usedFiles.length} items from context: ${contextName}`,
      );
      return contextContent.trim();
    } catch (error) {
      this.logger.error(
        `Error processing context data: ${error instanceof Error ? error.message : String(error)}`,
      );
      return `Error processing context data: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async recordContextQuery(
    contextName: string,
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

    // Queue writes to prevent concurrent modification of the same file
    const writeOperation = async () => {
      let retries = 3;
      let lastError: Error | null = null;

      while (retries > 0) {
        try {
          // Read the current index
          const indexData = await readFile(indexPath, 'utf-8');

          // Handle empty or invalid JSON
          if (!indexData || indexData.trim() === '') {
            this.logger.warn(
              `Empty index file for ${contextName}, skipping query record`,
            );
            return;
          }

          const index = JSON.parse(indexData);

          // Add the query
          if (!index.queries) {
            index.queries = [];
          }

          index.queries.push({
            timestamp: new Date().toISOString(),
            origin: 'anon',
            message: message,
            contextFilesUsed: filesUsed,
          });

          // Write back the updated index
          await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
          return; // Success
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retries--;
          if (retries > 0) {
            // Wait a bit before retrying
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      }

      // Only log warning instead of throwing to avoid breaking the request
      this.logger.warn(
        `Failed to record context query after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    };

    // Wait for any pending write to this file, then perform this write
    const existingWrite = this.writeQueue.get(indexPath);
    const newWrite = existingWrite
      ? existingWrite.then(writeOperation).catch(() => writeOperation())
      : writeOperation();

    this.writeQueue.set(indexPath, newWrite);

    // Clean up the queue after completion
    newWrite.finally(() => {
      if (this.writeQueue.get(indexPath) === newWrite) {
        this.writeQueue.delete(indexPath);
      }
    });

    await newWrite;
  }

  /**
   * Checks if a URL is relevant to the user's message based on its title/description
   * @param userMessage The user's message
   * @param link The link object with url, title, and optional description
   * @returns True if the URL seems relevant to the message
   */
  private async checkUrlRelevance(
    userMessage: string,
    link: { url: string; title: string; description?: string },
  ): Promise<boolean> {
    try {
      // Simple keyword matching for now - can be enhanced with LLM if needed
      const messageLower = userMessage.toLowerCase();
      const titleLower = link.title?.toLowerCase() || '';
      const descriptionLower = link.description?.toLowerCase() || '';

      // Check if message contains words from title or description
      const titleWords = titleLower.split(/\s+/).filter((w) => w.length > 3);
      const descWords = descriptionLower
        .split(/\s+/)
        .filter((w) => w.length > 3);

      for (const word of titleWords) {
        if (messageLower.includes(word)) {
          this.logger.log(
            `URL "${link.title}" is relevant - matched keyword: ${word}`,
          );
          return true;
        }
      }

      for (const word of descWords) {
        if (messageLower.includes(word)) {
          this.logger.log(
            `URL "${link.title}" is relevant - matched keyword from description: ${word}`,
          );
          return true;
        }
      }

      this.logger.debug(
        `URL "${link.title}" does not seem relevant to message`,
      );
      return false;
    } catch (error) {
      this.logger.error(
        `Error checking URL relevance: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Loads context information to be used as system prompt
   * @param contextName The name of the context to load
   * @param userMessage The original user message for tracking
   * @returns Formatted context information for use in system prompt
   */
  private async loadContextInformation(
    contextName: string,
    userMessage: string = '',
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
          this.logger.error(
            `Error reading context index: ${error instanceof Error ? error.message : String(error)}`,
          );
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
        this.logger.error(
          `Error listing context files: ${error instanceof Error ? error.message : String(error)}`,
        );
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
            this.logger.error(
              `Error reading file ${file}: ${error instanceof Error ? error.message : String(error)}`,
            );
            // Continue with other files
          }
        }
      }

      // Note: URL processing is now handled by RAG service in the two-step workflow
      // This legacy loadContextInformation method only handles markdown files
      // URLs are selected and fetched in ragService.selectRelevantFiles() and buildContextWithSelectedFiles()

      // Record the context query for analytics purposes
      if (usedFiles.length > 0) {
        try {
          await this.recordContextQuery(
            contextName,
            usedFiles,
            userMessage, // Use the actual user message instead of static text
          );
          this.logger.debug(
            `Recorded context usage of ${usedFiles.length} files/links for message: "${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}"`,
          );
        } catch (error) {
          // Non-critical operation, just log the error
          this.logger.warn(
            `Failed to record context query: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.log(
        `Generated system prompt from context: ${contextName} (${contextContent.length} characters, ${usedFiles.length} items)`,
      );
      return contextContent.trim();
    } catch (error) {
      this.logger.error(
        `Error generating system prompt from context: ${error instanceof Error ? error.message : String(error)}`,
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
      this.logger.error(
        `Error reading directory: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async ask(
    askDto: AskDto,
    file?: Express.Multer['File'],
  ): Promise<AskResponseDto> {
    let output: string | undefined;
    let usedSessionId = askDto.sessionId || randomUUID();
    let usedModel = 'none';
    let fullInput = '';
    let fullOutput = '';
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
    };
    let cost: any = undefined;

    // Define available models
    const availableModels = [
      'mistral',
      'anthropic',
      'openai',
      'anthropic-web-search',
    ];

    // Models eligible as fallbacks: anthropic-web-search is excluded because
    // it incurs per-search fees and should only run when explicitly requested
    const fallbackModels = ['mistral', 'anthropic', 'openai'];

    // Initialize with the selected model, or default to anthropic
    let selectedModel = askDto.model || 'anthropic';

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
      ...fallbackModels.filter((m) => m !== selectedModel),
    ];

    this.logger.log(
      `Processing request with models in fallback sequence: ${modelsToTry.join(', ')}`,
    );

    try {
      // Initialize a system prompt to contain context information
      let systemPrompt = '';
      let ragMetadata: any = undefined;

      // Load context information if context is specified
      const contextName = askDto.context || 'rukh';
      if (contextName && contextName !== '') {
        // Look up how many selectable resources this context actually has,
        // so two-step RAG selection only kicks in when there's something to
        // choose between. This replaces a blanket on/off env flag with
        // per-request gating based on context content.
        const contextPath = join(
          process.cwd(),
          'data',
          'contexts',
          contextName,
        );
        const indexPath = join(contextPath, 'index.json');
        let totalFiles = 0;
        let totalUrls = 0;
        if (existsSync(indexPath)) {
          const indexData = await readFile(indexPath, 'utf-8');
          const contextIndex = JSON.parse(indexData);
          totalFiles = contextIndex.files?.length || 0;
          totalUrls = contextIndex.links?.length || 0;
        }
        const totalResources = totalFiles + totalUrls;

        const maxFiles = this.RAG_MAX_FILES;

        // Two-step selection only runs when the caller explicitly asked for
        // a context (an implicit default context skips it) and that context
        // has more than one resource to choose from (nothing to select
        // otherwise).
        const ragEnabled = !!askDto.context && totalResources > 1;

        if (ragEnabled) {
          this.logger.log(`Using two-step RAG for context: ${contextName}`);

          try {
            // STEP 1: Select relevant files and URLs
            this.logger.log(
              `Step 1: Selecting relevant resources (max: ${maxFiles})`,
            );
            const { selectedFiles, selectedUrls, selectionCost } =
              await this.ragService.selectRelevantFiles(
                contextName,
                askDto.message,
                maxFiles,
              );

            this.logger.log(
              `Selected ${selectedFiles.length} files and ${selectedUrls?.length || 0} URLs`,
            );

            // STEP 2: Build context with only selected files and URLs
            this.logger.log(`Step 2: Building context with selected resources`);
            systemPrompt = await this.ragService.buildContextWithSelectedFiles(
              contextName,
              selectedFiles,
              selectedUrls,
            );

            // Record the query with selected files and URLs
            try {
              const usedResources = [
                ...selectedFiles,
                ...(selectedUrls || []).map((url) => `link:${url}`),
              ];
              await this.recordContextQuery(
                contextName,
                usedResources,
                askDto.message,
              );
              this.logger.debug(
                `Recorded context query with ${selectedFiles.length} files and ${selectedUrls?.length || 0} URLs`,
              );
            } catch (error) {
              this.logger.warn(
                `Failed to record context query: ${error instanceof Error ? error.message : String(error)}`,
              );
            }

            // Store RAG metadata for response (including selection cost)
            ragMetadata = {
              selectedFiles,
              selectedUrls,
              totalFilesAvailable: totalFiles,
              totalUrlsAvailable: totalUrls,
              selectionMethod: 'rag-two-step',
              selectionCost,
            };

            this.logger.log(
              `Two-step RAG completed: ${selectedFiles.length}/${totalFiles} files and ${selectedUrls?.length || 0}/${totalUrls} URLs selected (${systemPrompt.length} characters)`,
            );

            if (selectionCost) {
              this.logger.log(
                `Selection cost: $${selectionCost.total_cost.toFixed(6)} (input: $${selectionCost.input_cost.toFixed(6)}, output: $${selectionCost.output_cost.toFixed(6)})`,
              );
            }
          } catch (error) {
            this.logger.error(
              `Two-step RAG failed: ${error instanceof Error ? error.message : String(error)}, falling back to old method`,
            );
            // Fallback to old method
            systemPrompt = await this.loadContextInformation(
              contextName,
              askDto.message,
            );
          }
        } else {
          // Use old method if RAG is disabled
          this.logger.log(
            `Loading context information (legacy method): ${contextName}`,
          );
          systemPrompt = await this.loadContextInformation(
            contextName,
            askDto.message,
          );
        }

        this.logger.debug(
          `Generated system prompt with context information (${systemPrompt.length} characters)`,
        );
      }

      // Handle file upload if present
      const allowedExtensions = ['.md', '.csv'];
      const hasAllowedExtension =
        file &&
        allowedExtensions.some((ext) =>
          file.originalname.toLowerCase().endsWith(ext),
        );

      if (hasAllowedExtension) {
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
        this.logger.warn(`Ignoring unsupported file: ${file.originalname}`);
      }

      // Store full input for cost tracking (combining system prompt and user message)
      fullInput = systemPrompt
        ? systemPrompt + '\n\n' + askDto.message
        : askDto.message;

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
                askDto.message, // Send the clean message without context
                usedSessionId,
                effectiveSystemPrompt,
              );

              output = response.content;
              fullOutput = response.content;
              usedSessionId = response.sessionId;
              cost = response.cost;
              usedModel = 'mistral-large-latest';

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
                askDto.message, // Send the clean message without context
                usedSessionId,
                effectiveSystemPrompt,
              );

              output = response.content;
              fullOutput = response.content;
              usedSessionId = response.sessionId;
              usedModel = 'claude-sonnet-5';
              cost = response.cost;

              // Make sure we have valid usage data
              usage = response.usage || {
                input_tokens: Math.ceil(fullInput.length / 4), // Estimate if not provided
                output_tokens: Math.ceil(fullOutput.length / 4),
              };

              modelProcessed = true;
              this.logger.log(`Successfully processed with Anthropic model`);
              break;
            }

            case 'anthropic-web-search': {
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
                `Using ${effectiveSystemPrompt ? 'system prompt' : 'no system prompt'} with Anthropic (web search)`,
              );

              const response =
                await this.anthropicService.processMessageWithWebSearch(
                  askDto.message, // Send the clean message without context
                  usedSessionId,
                  effectiveSystemPrompt,
                );

              output = response.content;
              fullOutput = response.content;
              usedSessionId = response.sessionId;
              usedModel = 'claude-sonnet-5';
              cost = response.cost;

              // Make sure we have valid usage data
              usage = response.usage || {
                input_tokens: Math.ceil(fullInput.length / 4), // Estimate if not provided
                output_tokens: Math.ceil(fullOutput.length / 4),
              };

              modelProcessed = true;
              this.logger.log(
                `Successfully processed with Anthropic web search model`,
              );
              break;
            }

            case 'openai': {
              // Check if there's existing conversation
              const { isFirstMessage } =
                await this.openaiService.getConversationHistory(usedSessionId);

              // Only use system prompt for first message or if no history is available
              const effectiveSystemPrompt = isFirstMessage
                ? systemPrompt
                : undefined;

              this.logger.debug(
                `Using ${effectiveSystemPrompt ? 'system prompt' : 'no system prompt'} with OpenAI`,
              );

              const response = await this.openaiService.processMessage(
                askDto.message, // Send the clean message without context
                usedSessionId,
                effectiveSystemPrompt,
              );

              output = response.content;
              fullOutput = response.content;
              usedSessionId = response.sessionId;
              usedModel = 'gpt-4o';
              cost = response.cost;

              // Make sure we have valid usage data
              usage = response.usage || {
                input_tokens: Math.ceil(fullInput.length / 4), // Estimate if not provided
                output_tokens: Math.ceil(fullOutput.length / 4),
              };

              modelProcessed = true;
              this.logger.log(`Successfully processed with OpenAI model`);
              break;
            }

            default: {
              this.logger.warn(`Unsupported model: ${currentModel}, skipping`);
              break;
            }
          }
        } catch (error) {
          this.logger.error(
            `Error processing with model ${currentModel}: ${error instanceof Error ? error.message : String(error)}`,
          );
          lastError = error as Error;
          this.logger.log(`Falling back to next model in sequence...`);
        }
      }

      // If all models failed, log the last error
      if (!modelProcessed && lastError) {
        this.logger.error(
          `All models in fallback sequence failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
        );
      }

      // Track usage for all successful responses
      if (output) {
        this.logger.debug(
          `Tracking usage for anonymous with model ${usedModel}`,
        );
        this.logger.debug(
          `Token usage: input=${usage.input_tokens}, output=${usage.output_tokens}`,
        );

        try {
          await this.costTracker.trackUsageWithTokens(
            'anonymous',
            askDto.message,
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

      const response: AskResponseDto = {
        output,
        model: usedModel,
        sessionId: usedSessionId,
        usage: usage,
      };

      // Combine costs if we have both RAG selection cost and response generation cost
      if (cost && ragMetadata?.selectionCost) {
        // Add the selection cost to the response generation cost
        const combinedCost = {
          input_cost: Number(
            (cost.input_cost + ragMetadata.selectionCost.input_cost).toFixed(6),
          ),
          output_cost: Number(
            (cost.output_cost + ragMetadata.selectionCost.output_cost).toFixed(
              6,
            ),
          ),
          total_cost: Number(
            (cost.total_cost + ragMetadata.selectionCost.total_cost).toFixed(6),
          ),
        };
        response.cost = combinedCost;
        this.logger.log(
          `Combined cost (selection + generation): $${combinedCost.total_cost.toFixed(6)} (input: $${combinedCost.input_cost.toFixed(6)}, output: $${combinedCost.output_cost.toFixed(6)})`,
        );
      } else if (cost) {
        response.cost = cost;
        this.logger.log(
          `Request completed with cost: $${cost.total_cost.toFixed(6)} (input: $${cost.input_cost.toFixed(6)}, output: $${cost.output_cost.toFixed(6)})`,
        );
      }

      // Add RAG metadata if available
      if (ragMetadata) {
        response.rag = ragMetadata;
        this.logger.log(
          `RAG metadata: ${ragMetadata.selectedFiles.length}/${ragMetadata.totalFilesAvailable} files used`,
        );
      }

      return response;
    } catch (error) {
      this.logger.error(`Error in overall request processing:`, error);

      // Still return a response with available information
      return {
        output,
        model: usedModel,
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
        <h1>Rukh</h1>
        <p>Modular AI framework allowing personalized contexts and support for multiple LLMs</p>
        <div class="links">
            <a href="/api" class="button">Swagger UI</a>
            <a href="https://github.com/w3hc/rukh" target="_blank" rel="noopener noreferrer" class="button">GitHub Repo</a>
        </div>
        <br />
        <br />
        <img src="https://bafkreid5xwxz4bed67bxb2wjmwsec4uhlcjviwy7pkzwoyu5oesjd3sp64.ipfs.w3s.link" alt="built-with-ethereum-w3hc" width="150"/>
    </div>
</body>
</html>`;
  }
}

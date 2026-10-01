import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { RagService } from '../rag/rag.service';
import { writeFileAtomic } from '../storage/write-file-atomic';
import { RagMetadataDto } from '../dto/rag-metadata.dto';

export interface LoadedContext {
  systemPrompt: string;
  ragMetadata?: RagMetadataDto;
}

/**
 * Turns a context name into the system prompt a request runs with: two-step
 * RAG selection when the context has something to choose between, every
 * markdown file otherwise, and a record of what was used in the context's
 * index.json.
 */
@Injectable()
export class ContextLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ContextLoaderService.name);
  // Maximum number of files/URLs the two-step RAG selection step may pick
  private readonly RAG_MAX_FILES = 5;
  private writeQueue: Map<string, Promise<void>> = new Map();

  constructor(private readonly ragService: RagService) {}

  async onModuleInit() {
    const contextsPath = join(process.cwd(), 'data', 'contexts');
    if (!existsSync(contextsPath)) {
      this.logger.log('Creating contexts directory');
      await mkdir(contextsPath, { recursive: true });
    }
  }

  /**
   * Reads a context's index.json for a `model` override, if present.
   * Lets a context force a specific model (e.g. one that needs live web
   * fetch to verify external evidence) regardless of what the request asks
   * for.
   */
  async getModelOverride(contextName: string): Promise<string | undefined> {
    if (!contextName) {
      return undefined;
    }

    try {
      const indexPath = this.indexPath(contextName);

      if (!existsSync(indexPath)) {
        return undefined;
      }

      const indexData = await readFile(indexPath, 'utf-8');
      const contextIndex = JSON.parse(indexData);
      return contextIndex.model || undefined;
    } catch (error) {
      this.logger.warn(
        `Failed to read model override for context ${contextName}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * @param explicit Whether the caller named the context. An implicit
   *   default context never goes through two-step selection.
   */
  async load(
    contextName: string,
    message: string,
    explicit: boolean,
  ): Promise<LoadedContext> {
    if (!contextName) {
      return { systemPrompt: '' };
    }

    // Look up how many selectable resources this context actually has,
    // so two-step RAG selection only kicks in when there's something to
    // choose between. This replaces a blanket on/off env flag with
    // per-request gating based on context content.
    const indexPath = this.indexPath(contextName);
    let totalFiles = 0;
    let totalUrls = 0;
    if (existsSync(indexPath)) {
      try {
        const indexData = await readFile(indexPath, 'utf-8');
        const contextIndex = JSON.parse(indexData);
        totalFiles = contextIndex.files?.length || 0;
        totalUrls = contextIndex.links?.length || 0;
      } catch (error) {
        this.logger.warn(
          `Failed to read index for context ${contextName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const totalResources = totalFiles + totalUrls;

    let loaded: LoadedContext;

    // Two-step selection only runs when the caller explicitly asked for
    // a context and that context has more than one resource to choose from
    // (nothing to select otherwise).
    if (explicit && totalResources > 1) {
      try {
        loaded = await this.loadWithRag(
          contextName,
          message,
          totalFiles,
          totalUrls,
        );
      } catch (error) {
        this.logger.error(
          `Two-step RAG failed: ${error instanceof Error ? error.message : String(error)}, falling back to old method`,
        );
        loaded = {
          systemPrompt: await this.loadAllFiles(contextName, message),
        };
      }
    } else {
      this.logger.log(
        `Loading context information (legacy method): ${contextName}`,
      );
      loaded = { systemPrompt: await this.loadAllFiles(contextName, message) };
    }

    this.logger.debug(
      `Generated system prompt with context information (${loaded.systemPrompt.length} characters)`,
    );
    return loaded;
  }

  private async loadWithRag(
    contextName: string,
    message: string,
    totalFiles: number,
    totalUrls: number,
  ): Promise<LoadedContext> {
    const maxFiles = this.RAG_MAX_FILES;
    this.logger.log(`Using two-step RAG for context: ${contextName}`);

    // STEP 1: Select relevant files and URLs
    this.logger.log(`Step 1: Selecting relevant resources (max: ${maxFiles})`);
    const { selectedFiles, selectedUrls, selectionCost } =
      await this.ragService.selectRelevantFiles(contextName, message, maxFiles);

    this.logger.log(
      `Selected ${selectedFiles.length} files and ${selectedUrls?.length || 0} URLs`,
    );

    // STEP 2: Build context with only selected files and URLs
    this.logger.log(`Step 2: Building context with selected resources`);
    const systemPrompt = await this.ragService.buildContextWithSelectedFiles(
      contextName,
      selectedFiles,
      selectedUrls,
    );

    try {
      const usedResources = [
        ...selectedFiles,
        ...(selectedUrls || []).map((url) => `link:${url}`),
      ];
      await this.recordContextQuery(contextName, usedResources, message);
      this.logger.debug(
        `Recorded context query with ${selectedFiles.length} files and ${selectedUrls?.length || 0} URLs`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to record context query: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.logger.log(
      `Two-step RAG completed: ${selectedFiles.length}/${totalFiles} files and ${selectedUrls?.length || 0}/${totalUrls} URLs selected (${systemPrompt.length} characters)`,
    );

    if (selectionCost) {
      this.logger.log(
        `Selection cost: $${selectionCost.total_cost.toFixed(6)} (input: $${selectionCost.input_cost.toFixed(6)}, output: $${selectionCost.output_cost.toFixed(6)})`,
      );
    }

    return {
      systemPrompt,
      ragMetadata: {
        selectedFiles,
        selectedUrls,
        totalFilesAvailable: totalFiles,
        totalUrlsAvailable: totalUrls,
        selectionMethod: 'rag-two-step',
        selectionCost,
      },
    };
  }

  /**
   * Every markdown file in the context, as one system prompt. URLs are only
   * fetched by the two-step RAG path.
   */
  private async loadAllFiles(
    contextName: string,
    userMessage: string = '',
  ): Promise<string> {
    try {
      const contextPath = join(process.cwd(), 'data', 'contexts', contextName);

      if (!existsSync(contextPath)) {
        this.logger.warn(`Context ${contextName} not found`);
        return '';
      }

      const files = await this.getMarkdownFiles(contextPath);
      const usedFiles: string[] = [];

      let contextContent = `# Context: ${contextName}\n\n`;

      if (files && files.length > 0) {
        this.logger.log(
          `Loading ${files.length} files for context '${contextName}':`,
        );
        contextContent += `## Context Files\n\n`;

        for (const file of files) {
          try {
            const fileContent = await readFile(
              join(contextPath, file),
              'utf-8',
            );

            contextContent += `### File: ${file}\n${fileContent}\n\n`;
            usedFiles.push(file);
            this.logger.debug(`- Added file: ${file}`);
          } catch (error) {
            this.logger.error(
              `Error reading file ${file}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }

      if (usedFiles.length > 0) {
        try {
          await this.recordContextQuery(contextName, usedFiles, userMessage);
          this.logger.debug(
            `Recorded context usage of ${usedFiles.length} files/links for message: "${userMessage.substring(0, 50)}${userMessage.length > 50 ? '...' : ''}"`,
          );
        } catch (error) {
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

  private async recordContextQuery(
    contextName: string,
    filesUsed: string[],
    message: string,
  ): Promise<void> {
    const indexPath = this.indexPath(contextName);

    if (!existsSync(indexPath)) {
      throw new Error(`Context index file not found for ${contextName}`);
    }

    const writeOperation = async () => {
      let retries = 3;
      let lastError: Error | null = null;

      while (retries > 0) {
        try {
          const indexData = await readFile(indexPath, 'utf-8');

          if (!indexData || indexData.trim() === '') {
            this.logger.warn(
              `Empty index file for ${contextName}, skipping query record`,
            );
            return;
          }

          const index = JSON.parse(indexData);

          if (!index.queries) {
            index.queries = [];
          }

          index.queries.push({
            timestamp: new Date().toISOString(),
            origin: 'anon',
            message: message,
            contextFilesUsed: filesUsed,
          });

          await writeFileAtomic(indexPath, JSON.stringify(index, null, 2));
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retries--;
          if (retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      }

      // Only log instead of throwing, so a failed record never breaks the
      // request
      this.logger.warn(
        `Failed to record context query after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    };

    // Queue writes to the same index so concurrent requests cannot clobber
    // each other's records
    const existingWrite = this.writeQueue.get(indexPath);
    const newWrite = existingWrite
      ? existingWrite.then(writeOperation).catch(() => writeOperation())
      : writeOperation();

    this.writeQueue.set(indexPath, newWrite);

    newWrite.finally(() => {
      if (this.writeQueue.get(indexPath) === newWrite) {
        this.writeQueue.delete(indexPath);
      }
    });

    await newWrite;
  }

  private indexPath(contextName: string): string {
    return join(process.cwd(), 'data', 'contexts', contextName, 'index.json');
  }
}

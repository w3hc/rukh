import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MistralService } from '../mistral/mistral.service';
import { ContextService } from '../context/context.service';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

interface FileMetadata {
  name: string;
  description: string;
  index: number;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly mistralService: MistralService,
    private readonly contextService: ContextService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Step 1: Select relevant files based on user's question
   * Uses mistral-small for cost-effective file selection
   * Returns both selected files and selection cost
   */
  async selectRelevantFiles(
    contextName: string,
    userMessage: string,
    maxFiles: number = 5,
  ): Promise<{ selectedFiles: string[]; selectionCost: any }> {
    try {
      this.logger.log(
        `Starting file selection for context: ${contextName}, max files: ${maxFiles}`,
      );

      // Get context metadata (list of files with descriptions)
      const contextPath = join(process.cwd(), 'data', 'contexts', contextName);
      const indexPath = join(contextPath, 'index.json');

      if (!existsSync(indexPath)) {
        this.logger.warn(`Context index not found for: ${contextName}`);
        return { selectedFiles: [], selectionCost: null };
      }

      const indexData = await readFile(indexPath, 'utf-8');
      const contextIndex = JSON.parse(indexData);

      if (!contextIndex.files || contextIndex.files.length === 0) {
        this.logger.warn(`No files found in context: ${contextName}`);
        return { selectedFiles: [], selectionCost: null };
      }

      // Build file metadata list
      const fileMetadata: FileMetadata[] = contextIndex.files.map(
        (file: any, index: number) => ({
          name: file.name,
          description: file.description || 'No description',
          index: index + 1,
        }),
      );

      this.logger.debug(
        `Found ${fileMetadata.length} files in context: ${contextName}`,
      );

      // Build selection prompt
      const selectionPrompt = this.buildSelectionPrompt(
        userMessage,
        fileMetadata,
        maxFiles,
      );

      // Call mistral-small for file selection
      this.logger.debug('Calling mistral-small for file selection');
      const response = await this.mistralService.processMessageWithModel(
        selectionPrompt,
        'mistral-small-latest', // Use mistral-small for cost efficiency
        undefined, // No session needed for this one-off request
        undefined, // No system prompt needed
      );

      // Parse the response to get selected file indices
      let selectedFiles = this.parseSelectionResponse(
        response.content,
        fileMetadata,
      );

      // Get list of required files from config
      const requiredFilesConfig = this.configService.get<string>('RAG_REQUIRED_FILES') || '';
      const requiredFiles = requiredFilesConfig
        .split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      // Always include required files if they exist in the context
      for (const requiredFile of requiredFiles) {
        const fileExists = contextIndex.files.find(
          (f: any) => f.name === requiredFile,
        );

        if (fileExists && !selectedFiles.includes(requiredFile)) {
          selectedFiles = [requiredFile, ...selectedFiles];
          this.logger.log(`Added ${requiredFile} as a required file`);
        }
      }

      this.logger.log(
        `Selected ${selectedFiles.length} files: ${selectedFiles.join(', ')}`,
      );

      // Return selected files along with the cost of the selection request
      return {
        selectedFiles,
        selectionCost: response.cost,
      };
    } catch (error) {
      this.logger.error(
        `Error in file selection for context ${contextName}: ${error.message}`,
      );
      // Fallback: return all files if selection fails
      try {
        const contextPath = join(
          process.cwd(),
          'data',
          'contexts',
          contextName,
        );
        const indexPath = join(contextPath, 'index.json');
        const indexData = await readFile(indexPath, 'utf-8');
        const contextIndex = JSON.parse(indexData);
        return {
          selectedFiles: contextIndex.files.map((f: any) => f.name),
          selectionCost: null,
        };
      } catch (fallbackError) {
        this.logger.error(
          `Fallback also failed: ${fallbackError.message}, returning empty array`,
        );
        return { selectedFiles: [], selectionCost: null };
      }
    }
  }

  /**
   * Build the prompt for file selection
   */
  private buildSelectionPrompt(
    userMessage: string,
    fileMetadata: FileMetadata[],
    maxFiles: number,
  ): string {
    const fileList = fileMetadata
      .map((file) => `${file.index}. ${file.name} - "${file.description}"`)
      .join('\n');

    return `You are a file selection assistant. Given a user's question and a list of available files, select the most relevant files to answer the question.

User's question: "${userMessage}"

Available files:
${fileList}

Instructions:
- Select up to ${maxFiles} most relevant files
- Return ONLY a JSON array of file numbers (integers)
- If no files are relevant, return an empty array []
- Do not include any explanation, only the JSON array

Example response format: [1, 3, 5]

Your response:`;
  }

  /**
   * Parse the LLM response to extract selected file indices
   */
  private parseSelectionResponse(
    response: string,
    fileMetadata: FileMetadata[],
  ): string[] {
    try {
      this.logger.debug(`Parsing selection response: ${response}`);

      // Try to extract JSON array from the response
      const jsonMatch = response.match(/\[[\d,\s]*\]/);
      if (!jsonMatch) {
        this.logger.warn('No valid JSON array found in response');
        // Fallback: return all files
        return fileMetadata.map((f) => f.name);
      }

      const selectedIndices: number[] = JSON.parse(jsonMatch[0]);
      this.logger.debug(`Parsed indices: ${selectedIndices.join(', ')}`);

      // Convert indices to filenames
      const selectedFiles = selectedIndices
        .map((index) => {
          const file = fileMetadata.find((f) => f.index === index);
          return file ? file.name : null;
        })
        .filter((name): name is string => name !== null);

      return selectedFiles;
    } catch (error) {
      this.logger.error(`Error parsing selection response: ${error.message}`);
      // Fallback: return all files
      return fileMetadata.map((f) => f.name);
    }
  }

  /**
   * Step 2: Build context content with only selected files
   */
  async buildContextWithSelectedFiles(
    contextName: string,
    selectedFiles: string[],
    password?: string,
  ): Promise<string> {
    try {
      if (selectedFiles.length === 0) {
        this.logger.warn('No files selected, returning empty context');
        return '';
      }

      this.logger.log(
        `Building context with ${selectedFiles.length} selected files`,
      );

      const contextPath = join(process.cwd(), 'data', 'contexts', contextName);
      const indexPath = join(contextPath, 'index.json');

      let contextContent = `# Context: ${contextName}\n\n`;
      contextContent += `## Selected Context Files\n\n`;

      // Get list of required files from config to ensure they come first
      const requiredFilesConfig = this.configService.get<string>('RAG_REQUIRED_FILES') || '';
      const requiredFiles = requiredFilesConfig
        .split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      // Sort files: required files first (in order), then other files
      const sortedFiles = [...selectedFiles].sort((a, b) => {
        const aIsRequired = requiredFiles.includes(a);
        const bIsRequired = requiredFiles.includes(b);

        if (aIsRequired && !bIsRequired) return -1;
        if (!aIsRequired && bIsRequired) return 1;
        if (aIsRequired && bIsRequired) {
          return requiredFiles.indexOf(a) - requiredFiles.indexOf(b);
        }
        return 0;
      });

      // Read each selected file
      for (const fileName of sortedFiles) {
        try {
          const filePath = join(contextPath, fileName);

          if (!existsSync(filePath)) {
            this.logger.warn(`File not found: ${fileName}`);
            continue;
          }

          const fileContent = await readFile(filePath, 'utf-8');
          contextContent += `### File: ${fileName}\n${fileContent}\n\n`;
          this.logger.debug(`Added file to context: ${fileName}`);
        } catch (error) {
          this.logger.error(
            `Error reading file ${fileName}: ${error.message}`,
          );
        }
      }

      // Also process links if they exist
      if (existsSync(indexPath)) {
        try {
          const indexData = await readFile(indexPath, 'utf-8');
          const contextIndex = JSON.parse(indexData);

          if (contextIndex.links && contextIndex.links.length > 0) {
            this.logger.debug(
              `Note: Links are not yet filtered by RAG, including all ${contextIndex.links.length} links`,
            );
            // TODO: Implement link selection in future enhancement
          }
        } catch (error) {
          this.logger.error(`Error reading context index: ${error.message}`);
        }
      }

      this.logger.log(
        `Context built successfully with ${selectedFiles.length} files (${contextContent.length} characters)`,
      );

      return contextContent.trim();
    } catch (error) {
      this.logger.error(`Error building context: ${error.message}`);
      return '';
    }
  }
}

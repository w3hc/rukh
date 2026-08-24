import { Injectable, Logger } from '@nestjs/common';
import { MistralService } from '../mistral/mistral.service';
import { ContextService } from '../context/context.service';
import { WebReaderService } from '../web/web-reader.service';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

interface FileMetadata {
  name: string;
  description: string;
  index: number;
  type: 'file' | 'url';
  url?: string;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  // Files always included in the context, regardless of selection
  private readonly REQUIRED_FILES = ['instruction-file.md'];

  constructor(
    private readonly mistralService: MistralService,
    private readonly contextService: ContextService,
    private readonly webReaderService: WebReaderService,
  ) {}

  /**
   * Step 1: Select relevant files and URLs based on user's question
   * Uses ministral-3b for cost-effective, low-latency resource selection
   * Returns both selected resources (files and URLs) and selection cost
   */
  async selectRelevantFiles(
    contextName: string,
    userMessage: string,
    maxFiles: number = 5,
  ): Promise<{
    selectedFiles: string[];
    selectionCost: any;
    selectedUrls?: string[];
  }> {
    try {
      this.logger.log(
        `Starting resource selection for context: ${contextName}, max resources: ${maxFiles}`,
      );

      // Get context metadata (list of files and URLs with descriptions)
      const contextPath = join(process.cwd(), 'data', 'contexts', contextName);
      const indexPath = join(contextPath, 'index.json');

      if (!existsSync(indexPath)) {
        this.logger.warn(`Context index not found for: ${contextName}`);
        return { selectedFiles: [], selectionCost: null, selectedUrls: [] };
      }

      const indexData = await readFile(indexPath, 'utf-8');
      const contextIndex = JSON.parse(indexData);

      if (!contextIndex.files || contextIndex.files.length === 0) {
        this.logger.warn(`No files found in context: ${contextName}`);
        return { selectedFiles: [], selectionCost: null, selectedUrls: [] };
      }

      // Build resource metadata list (files + URLs)
      const fileMetadata: FileMetadata[] = contextIndex.files.map(
        (file: any, index: number) => ({
          name: file.name,
          description: file.description || 'No description',
          index: index + 1,
          type: 'file' as const,
        }),
      );

      // Add URLs to the resource list
      const urlMetadata: FileMetadata[] = (contextIndex.links || []).map(
        (link: any, index: number) => ({
          name: link.title,
          description: link.description || link.url,
          index: fileMetadata.length + index + 1,
          type: 'url' as const,
          url: link.url,
        }),
      );

      const allResources = [...fileMetadata, ...urlMetadata];

      this.logger.debug(
        `Found ${fileMetadata.length} files and ${urlMetadata.length} URLs in context: ${contextName}`,
      );

      // Build selection prompt with all resources (files + URLs)
      const selectionPrompt = this.buildSelectionPrompt(
        userMessage,
        allResources,
        maxFiles,
      );

      // Call ministral-3b for resource selection
      this.logger.debug('Calling ministral-3b for resource selection');
      const response = await this.mistralService.processMessageWithModel(
        selectionPrompt,
        'ministral-3b-latest', // Use Ministral 3B: cheapest and fastest, well-suited to simple resource selection
        undefined, // No session needed for this one-off request
        undefined, // No system prompt needed
      );

      // Parse the response to get selected resource indices
      const selectedResources = this.parseSelectionResponse(
        response.content,
        allResources,
      );

      // Separate files and URLs
      let selectedFiles = selectedResources
        .filter((r) => !r.startsWith('url:'))
        .map((r) => r);

      const selectedUrls = selectedResources
        .filter((r) => r.startsWith('url:'))
        .map((r) => r.replace('url:', ''));

      // Always include required files if they exist in the context
      for (const requiredFile of this.REQUIRED_FILES) {
        const fileExists = contextIndex.files.find(
          (f: any) => f.name === requiredFile,
        );

        if (fileExists && !selectedFiles.includes(requiredFile)) {
          selectedFiles = [requiredFile, ...selectedFiles];
          this.logger.log(`Added ${requiredFile} as a required file`);
        }
      }

      this.logger.log(
        `Selected ${selectedFiles.length} files and ${selectedUrls.length} URLs`,
      );
      this.logger.debug(`Files: ${selectedFiles.join(', ')}`);
      if (selectedUrls.length > 0) {
        this.logger.debug(`URLs: ${selectedUrls.join(', ')}`);
      }

      // Return selected resources along with the cost of the selection request
      return {
        selectedFiles,
        selectedUrls,
        selectionCost: response.cost,
      };
    } catch (error) {
      this.logger.error(
        `Error in file selection for context ${contextName}: ${error instanceof Error ? error.message : String(error)}`,
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
          `Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}, returning empty array`,
        );
        return { selectedFiles: [], selectionCost: null };
      }
    }
  }

  /**
   * Build the prompt for resource selection (files and URLs)
   */
  private buildSelectionPrompt(
    userMessage: string,
    resourceMetadata: FileMetadata[],
    maxResources: number,
  ): string {
    const resourceList = resourceMetadata
      .map((resource) => {
        const type = resource.type === 'url' ? '[URL]' : '[FILE]';
        return `${resource.index}. ${type} ${resource.name} - "${resource.description}"`;
      })
      .join('\n');

    return `You are a resource selection assistant. Given a user's question and a list of available files and URLs, select the most relevant resources to answer the question.

User's question: "${userMessage}"

Available resources:
${resourceList}

Instructions:
- Select up to ${maxResources} most relevant resources (files or URLs)
- Return ONLY a JSON array of resource numbers (integers)
- If no resources are relevant, return an empty array []
- Do not include any explanation, only the JSON array

Example response format: [1, 3, 5]

Your response:`;
  }

  /**
   * Parse the LLM response to extract selected resource indices
   * Returns array with file names and URLs (prefixed with "url:")
   */
  private parseSelectionResponse(
    response: string,
    resourceMetadata: FileMetadata[],
  ): string[] {
    try {
      this.logger.debug(`Parsing selection response: ${response}`);

      // Try to extract JSON array from the response
      const jsonMatch = response.match(/\[[\d,\s]*\]/);
      if (!jsonMatch) {
        this.logger.warn('No valid JSON array found in response');
        // Fallback: return all resources
        return resourceMetadata.map((r) =>
          r.type === 'url' ? `url:${r.url}` : r.name,
        );
      }

      const selectedIndices: number[] = JSON.parse(jsonMatch[0]);
      this.logger.debug(`Parsed indices: ${selectedIndices.join(', ')}`);

      // Convert indices to resource identifiers (filenames or URL)
      const selectedResources = selectedIndices
        .map((index) => {
          const resource = resourceMetadata.find((r) => r.index === index);
          if (!resource) return null;

          // For URLs, prefix with "url:" to distinguish from files
          return resource.type === 'url'
            ? `url:${resource.url}`
            : resource.name;
        })
        .filter((name): name is string => name !== null);

      return selectedResources;
    } catch (error) {
      this.logger.error(
        `Error parsing selection response: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Fallback: return all resources
      return resourceMetadata.map((r) =>
        r.type === 'url' ? `url:${r.url}` : r.name,
      );
    }
  }

  /**
   * Step 2: Build context content with only selected files and URLs
   */
  async buildContextWithSelectedFiles(
    contextName: string,
    selectedFiles: string[],
    selectedUrls?: string[],
  ): Promise<string> {
    try {
      if (
        selectedFiles.length === 0 &&
        (!selectedUrls || selectedUrls.length === 0)
      ) {
        this.logger.warn('No resources selected, returning empty context');
        return '';
      }

      this.logger.log(
        `Building context with ${selectedFiles.length} selected files and ${selectedUrls?.length || 0} URLs`,
      );

      const contextPath = join(process.cwd(), 'data', 'contexts', contextName);
      const indexPath = join(contextPath, 'index.json');

      let contextContent = `# Context: ${contextName}\n\n`;
      if (selectedFiles.length > 0) {
        contextContent += `## Selected Context Files\n\n`;
      }

      // Sort files: required files first (in order), then other files
      const sortedFiles = [...selectedFiles].sort((a, b) => {
        const aIsRequired = this.REQUIRED_FILES.includes(a);
        const bIsRequired = this.REQUIRED_FILES.includes(b);

        if (aIsRequired && !bIsRequired) return -1;
        if (!aIsRequired && bIsRequired) return 1;
        if (aIsRequired && bIsRequired) {
          return (
            this.REQUIRED_FILES.indexOf(a) - this.REQUIRED_FILES.indexOf(b)
          );
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
            `Error reading file ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Process selected URLs
      if (selectedUrls && selectedUrls.length > 0) {
        contextContent += `## Selected External Resources\n\n`;

        // Get link metadata from context index
        let linkMetadata: any[] = [];
        if (existsSync(indexPath)) {
          try {
            const indexData = await readFile(indexPath, 'utf-8');
            const contextIndex = JSON.parse(indexData);
            linkMetadata = contextIndex.links || [];
          } catch (error) {
            this.logger.error(
              `Error reading context index: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        for (const url of selectedUrls) {
          try {
            this.logger.log(`Fetching content from URL: ${url}`);

            // Find link metadata
            const link = linkMetadata.find((l: any) => l.url === url);
            const linkTitle = link?.title || url;

            // Use WebReaderService to extract content from the URL
            const extractedContent =
              await this.webReaderService.extractForLLM(url);

            // Add the extracted content to the context
            contextContent += `### Link: ${linkTitle}\n${extractedContent.text}\n\n`;
            this.logger.debug(`Added URL content to context: ${linkTitle}`);
          } catch (error) {
            this.logger.error(
              `Error fetching URL ${url}: ${error instanceof Error ? error.message : String(error)}`,
            );
            // Add a fallback note
            contextContent += `### Link: ${url}\nCould not fetch content from this URL.\n\n`;
          }
        }
      }

      this.logger.log(
        `Context built successfully with ${selectedFiles.length} files and ${selectedUrls?.length || 0} URLs (${contextContent.length} characters)`,
      );

      return contextContent.trim();
    } catch (error) {
      this.logger.error(
        `Error building context: ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }
}

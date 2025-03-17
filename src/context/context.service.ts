import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { mkdir, rm, writeFile, readFile, stat, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  ContextFile,
  ContextIndex,
  ContextQuery,
  ContextLink,
} from '../dto/context.dto';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);
  private readonly contextsPath: string;

  constructor() {
    this.contextsPath = join(process.cwd(), 'data', 'contexts');
  }

  /**
   * Get the path to a context's index file
   */
  private getContextIndexPath(contextName: string): string {
    return join(this.contextsPath, contextName, 'index.json');
  }

  /**
   * Get a context's index file content
   */
  private async getContextIndex(
    contextName: string,
  ): Promise<ContextIndex | null> {
    const indexPath = this.getContextIndexPath(contextName);

    if (!existsSync(indexPath)) {
      return null;
    }

    try {
      const data = await readFile(indexPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error(`Failed to read context index: ${error.message}`);
      return null;
    }
  }

  /**
   * Save a context's index file
   */
  private async saveContextIndex(
    contextName: string,
    index: ContextIndex,
  ): Promise<void> {
    const indexPath = this.getContextIndexPath(contextName);

    try {
      await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to write context index: ${error.message}`);
      throw new Error(`Failed to write context index: ${error.message}`);
    }
  }

  /**
   * Validate a context's password
   */
  private async validatePassword(
    contextName: string,
    password: string,
  ): Promise<boolean> {
    const contextIndex = await this.getContextIndex(contextName);

    if (!contextIndex) {
      return false;
    }

    return contextIndex.password === password;
  }

  /**
   * Create a new context
   */
  async createContext(
    name: string,
    password: string,
    description: string = '',
  ): Promise<string> {
    const contextPath = join(this.contextsPath, name);

    if (existsSync(contextPath)) {
      throw new Error(`Context '${name}' already exists`);
    }

    try {
      // Create the context directory
      await mkdir(contextPath, { recursive: true });

      // Create the index file
      const contextIndex: ContextIndex = {
        name,
        password,
        description,
        numberOfFiles: 0,
        totalSize: 0,
        files: [],
        links: [], // Initialize empty links array
        queries: [],
      };

      await this.saveContextIndex(name, contextIndex);

      this.logger.log(`Created new context: ${name}`);
      return contextPath;
    } catch (error) {
      this.logger.error(`Failed to create context: ${name}`, error);
      throw new Error(`Failed to create context: ${error.message}`);
    }
  }

  /**
   * Delete a context
   */
  async deleteContext(name: string, password: string): Promise<void> {
    const contextPath = join(this.contextsPath, name);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${name}' not found`);
    }

    if (!(await this.validatePassword(name, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    try {
      await rm(contextPath, { recursive: true });
      this.logger.log(`Deleted context: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to delete context: ${name}`, error);
      throw new Error(`Failed to delete context: ${error.message}`);
    }
  }

  /**
   * Upload a file to a context
   */
  async uploadFile(
    contextName: string,
    fileName: string,
    content: string,
    password: string,
    fileDescription: string = '',
  ): Promise<{ path: string; wasOverwritten: boolean }> {
    const contextPath = join(this.contextsPath, contextName);
    const filePath = join(contextPath, fileName);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${contextName}' not found`);
    }

    if (!(await this.validatePassword(contextName, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    if (!fileName.endsWith('.md')) {
      throw new Error('Only .md files are allowed');
    }

    // Check if file already exists - KEY FIX: Use a clearly named flag
    const fileExists = existsSync(filePath);
    this.logger.debug(`File exists check for ${filePath}: ${fileExists}`);

    try {
      // Write the file
      await writeFile(filePath, content, 'utf-8');

      // Update the index
      const contextIndex = await this.getContextIndex(contextName);
      if (!contextIndex) {
        throw new Error(`Context index not found for ${contextName}`);
      }

      // Calculate file size in KB
      const fileStats = await stat(filePath);
      const fileSizeKB = Math.ceil(fileStats.size / 1024);

      // Update or add the file in the index
      const existingFileIndex = contextIndex.files.findIndex(
        (f) => f.name === fileName,
      );

      if (existingFileIndex >= 0) {
        // Update existing file
        const oldSize = contextIndex.files[existingFileIndex].size;
        contextIndex.files[existingFileIndex] = {
          name: fileName,
          description:
            fileDescription ||
            contextIndex.files[existingFileIndex].description,
          size: fileSizeKB,
        };
        contextIndex.totalSize = contextIndex.totalSize - oldSize + fileSizeKB;
      } else {
        // Add new file
        contextIndex.files.push({
          name: fileName,
          description: fileDescription,
          size: fileSizeKB,
        });
        contextIndex.numberOfFiles++;
        contextIndex.totalSize += fileSizeKB;
      }

      // Save the updated index
      await this.saveContextIndex(contextName, contextIndex);

      this.logger.log(
        `${fileExists ? 'Updated' : 'Added'} file ${fileName} in context: ${contextName}`,
      );

      return {
        path: filePath,
        wasOverwritten: fileExists, // Return original flag, not checking again
      };
    } catch (error) {
      this.logger.error(
        `Failed to upload file to context: ${contextName}`,
        error,
      );
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  /**
   * Delete a file from a context
   */
  async deleteFile(
    contextName: string,
    fileName: string,
    password: string,
  ): Promise<void> {
    const contextPath = join(this.contextsPath, contextName);
    const filePath = join(contextPath, fileName);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${contextName}' not found`);
    }

    if (!(await this.validatePassword(contextName, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    if (!existsSync(filePath)) {
      throw new Error(
        `File '${fileName}' not found in context '${contextName}'`,
      );
    }

    try {
      // Get file stats before deletion to update size
      const fileStats = await stat(filePath);
      const fileSizeKB = Math.ceil(fileStats.size / 1024);

      // Delete the file
      await rm(filePath);

      // Update the index
      const contextIndex = await this.getContextIndex(contextName);
      if (!contextIndex) {
        throw new Error(`Context index not found for ${contextName}`);
      }

      // Remove the file from the index
      contextIndex.files = contextIndex.files.filter(
        (f) => f.name !== fileName,
      );
      contextIndex.numberOfFiles--;
      contextIndex.totalSize -= fileSizeKB;

      // Save the updated index
      await this.saveContextIndex(contextName, contextIndex);

      this.logger.log(`Deleted file ${fileName} from context: ${contextName}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete file from context: ${contextName}`,
        error,
      );
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  /**
   * Add a query to a context's history
   */
  async recordQuery(
    contextName: string,
    origin: string,
    contextFilesUsed: string[],
  ): Promise<void> {
    try {
      const contextIndex = await this.getContextIndex(contextName);
      if (!contextIndex) {
        this.logger.warn(
          `Unable to record query: Context ${contextName} not found`,
        );
        return;
      }

      // Add the query to the index
      contextIndex.queries.push({
        timestamp: new Date().toISOString(),
        origin,
        contextFilesUsed,
      });

      // Save the updated index
      await this.saveContextIndex(contextName, contextIndex);

      this.logger.debug(
        `Recorded query from ${origin} in context: ${contextName}`,
      );
    } catch (error) {
      this.logger.error(`Failed to record query: ${error.message}`);
      // Don't throw error as this is a non-critical operation
    }
  }

  /**
   * List all contexts
   */
  async listContexts(): Promise<{ name: string; description: string }[]> {
    try {
      // Create contexts directory if it doesn't exist
      if (!existsSync(this.contextsPath)) {
        await mkdir(this.contextsPath, { recursive: true });
      }

      const contextFolders = await readdir(this.contextsPath);
      const contexts: { name: string; description: string }[] = [];

      for (const folderName of contextFolders) {
        const indexPath = join(
          this.contextsPath,
          folderName.toString(),
          'index.json',
        );
        if (existsSync(indexPath)) {
          const indexContent = await readFile(indexPath, 'utf-8');
          const index = JSON.parse(indexContent) as ContextIndex;
          contexts.push({
            name: index.name,
            description: index.description,
          });
        }
      }

      return contexts;
    } catch (error) {
      this.logger.error('Error listing contexts:', error);
      return [];
    }
  }

  /**
   * Get a list of directories in a path
   */
  private async getDirectories(path: string): Promise<string[]> {
    try {
      const { readdir } = require('fs/promises');
      const entries = await readdir(path, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((dir) => dir.name);
    } catch (error) {
      this.logger.error(`Failed to get directories: ${error.message}`);
      return [];
    }
  }

  /**
   * Get a list of files in a context
   */
  async listContextFiles(
    contextName: string,
    password: string,
  ): Promise<ContextFile[]> {
    if (!(await this.validatePassword(contextName, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    const contextIndex = await this.getContextIndex(contextName);
    if (!contextIndex) {
      throw new Error(`Context '${contextName}' not found`);
    }

    return contextIndex.files;
  }

  /**
   * Get file content from a context
   */
  async getFileContent(
    contextName: string,
    fileName: string,
    password: string,
  ): Promise<string> {
    const contextPath = join(this.contextsPath, contextName);
    const filePath = join(contextPath, fileName);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${contextName}' not found`);
    }

    if (!(await this.validatePassword(contextName, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    if (!existsSync(filePath)) {
      throw new Error(
        `File '${fileName}' not found in context '${contextName}'`,
      );
    }

    try {
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to read file content: ${error.message}`);
      throw new Error(`Failed to read file content: ${error.message}`);
    }
  }

  /**
   * Add a link to a context
   */
  async addLink(
    contextName: string,
    link: {
      title: string;
      url: string;
      description?: string;
    },
    password: string,
  ): Promise<{ success: boolean; link: ContextLink }> {
    const contextPath = join(this.contextsPath, contextName);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${contextName}' not found`);
    }

    if (!(await this.validatePassword(contextName, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    try {
      // Get the current context index
      const contextIndex = await this.getContextIndex(contextName);
      if (!contextIndex) {
        throw new Error(`Context index not found for ${contextName}`);
      }

      // Initialize links array if it doesn't exist (for backward compatibility)
      if (!contextIndex.links) {
        contextIndex.links = [];
      }

      // Create the new link object with timestamp
      const newLink: ContextLink = {
        title: link.title,
        url: link.url,
        description: link.description || '',
        timestamp: new Date().toISOString(),
      };

      // Add the link to the context
      contextIndex.links.push(newLink);

      // Save the updated index
      await this.saveContextIndex(contextName, contextIndex);

      this.logger.log(`Added link "${link.title}" to context: ${contextName}`);

      return {
        success: true,
        link: newLink,
      };
    } catch (error) {
      this.logger.error(`Failed to add link to context: ${error.message}`);
      throw new Error(`Failed to add link: ${error.message}`);
    }
  }

  /**
   * List all links in a context
   */
  async listLinks(
    contextName: string,
    password: string,
  ): Promise<ContextLink[]> {
    if (!(await this.validatePassword(contextName, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    const contextIndex = await this.getContextIndex(contextName);
    if (!contextIndex) {
      throw new Error(`Context '${contextName}' not found`);
    }

    // Return the links array or an empty array if it doesn't exist
    return contextIndex.links || [];
  }

  /**
   * Delete a link from a context by its URL
   */
  async deleteLink(
    contextName: string,
    url: string,
    password: string,
  ): Promise<boolean> {
    const contextPath = join(this.contextsPath, contextName);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${contextName}' not found`);
    }

    if (!(await this.validatePassword(contextName, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    try {
      // Get the current context index
      const contextIndex = await this.getContextIndex(contextName);
      if (!contextIndex) {
        throw new Error(`Context index not found for ${contextName}`);
      }

      // Check if links array exists
      if (!contextIndex.links || contextIndex.links.length === 0) {
        throw new Error(`No links found in context '${contextName}'`);
      }

      // Find the link to delete
      const initialLength = contextIndex.links.length;
      contextIndex.links = contextIndex.links.filter(
        (link) => link.url !== url,
      );

      // Check if any link was removed
      if (contextIndex.links.length === initialLength) {
        throw new Error(`Link with URL '${url}' not found in context`);
      }

      // Save the updated index
      await this.saveContextIndex(contextName, contextIndex);

      this.logger.log(
        `Deleted link with URL "${url}" from context: ${contextName}`,
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete link from context: ${error.message}`);
      throw new Error(`Failed to delete link: ${error.message}`);
    }
  }
}

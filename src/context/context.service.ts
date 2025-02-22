import { Injectable, Logger } from '@nestjs/common';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);
  private readonly contextsPath: string;

  constructor() {
    this.contextsPath = join(process.cwd(), 'data', 'contexts');
  }

  async createContext(name: string): Promise<string> {
    const contextPath = join(this.contextsPath, name);

    if (existsSync(contextPath)) {
      throw new Error(`Context '${name}' already exists`);
    }

    try {
      await mkdir(contextPath, { recursive: true });
      this.logger.log(`Created new context: ${name}`);
      return contextPath;
    } catch (error) {
      this.logger.error(`Failed to create context: ${name}`, error);
      throw new Error(`Failed to create context: ${error.message}`);
    }
  }

  async deleteContext(name: string): Promise<void> {
    const contextPath = join(this.contextsPath, name);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${name}' not found`);
    }

    try {
      await rm(contextPath, { recursive: true });
      this.logger.log(`Deleted context: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to delete context: ${name}`, error);
      throw new Error(`Failed to delete context: ${error.message}`);
    }
  }

  async uploadFile(
    contextName: string,
    fileName: string,
    content: string,
  ): Promise<{ path: string; wasOverwritten: boolean }> {
    const contextPath = join(this.contextsPath, contextName);
    const filePath = join(contextPath, fileName);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${contextName}' not found`);
    }

    // Verify file extension
    if (!fileName.endsWith('.md')) {
      throw new Error('Only .md files are allowed');
    }

    const fileExists = existsSync(filePath);

    try {
      await writeFile(filePath, content, 'utf-8');
      this.logger.log(
        `${fileExists ? 'Updated' : 'Added'} file ${fileName} in context: ${contextName}`,
      );
      return {
        path: filePath,
        wasOverwritten: fileExists,
      };
    } catch (error) {
      this.logger.error(
        `Failed to upload file to context: ${contextName}`,
        error,
      );
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  async deleteFile(contextName: string, fileName: string): Promise<void> {
    const contextPath = join(this.contextsPath, contextName);
    const filePath = join(contextPath, fileName);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${contextName}' not found`);
    }

    if (!existsSync(filePath)) {
      throw new Error(
        `File '${fileName}' not found in context '${contextName}'`,
      );
    }

    try {
      await rm(filePath);
      this.logger.log(`Deleted file ${fileName} from context: ${contextName}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete file from context: ${contextName}`,
        error,
      );
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }
}

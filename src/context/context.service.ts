import { Injectable, Logger } from '@nestjs/common';
import { mkdir, rm } from 'fs/promises';
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
}

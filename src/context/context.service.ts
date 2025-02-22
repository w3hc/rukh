import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

interface ContextConfig {
  contexts: Array<{
    name: string;
    password: string;
  }>;
}

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);
  private readonly contextsPath: string;
  private readonly configPath: string;

  constructor() {
    this.contextsPath = join(process.cwd(), 'data', 'contexts');
    this.configPath = join(this.contextsPath, 'index.json');
  }

  private async validatePassword(
    contextName: string,
    password: string,
  ): Promise<boolean> {
    try {
      const configData = await readFile(this.configPath, 'utf-8');
      const config: ContextConfig = JSON.parse(configData);
      const context = config.contexts.find((ctx) => ctx.name === contextName);
      return context?.password === password;
    } catch (error) {
      this.logger.error(`Failed to validate password: ${error.message}`);
      return false;
    }
  }

  private async readConfig(): Promise<ContextConfig> {
    try {
      if (existsSync(this.configPath)) {
        const data = await readFile(this.configPath, 'utf-8');
        return JSON.parse(data);
      }
      return { contexts: [] };
    } catch (error) {
      this.logger.error(`Failed to read config: ${error.message}`);
      return { contexts: [] };
    }
  }

  private async writeConfig(config: ContextConfig): Promise<void> {
    try {
      const data = JSON.stringify(config, null, 2);
      await writeFile(this.configPath, data, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to write config: ${error.message}`);
      throw new Error(`Failed to write config: ${error.message}`);
    }
  }

  async createContext(name: string, password: string): Promise<string> {
    const contextPath = join(this.contextsPath, name);

    if (existsSync(contextPath)) {
      throw new Error(`Context '${name}' already exists`);
    }

    try {
      // Create context directory
      await mkdir(contextPath, { recursive: true });

      // Update config file
      const config = await this.readConfig();
      config.contexts.push({ name, password });
      await this.writeConfig(config);

      this.logger.log(`Created new context: ${name}`);
      return contextPath;
    } catch (error) {
      this.logger.error(`Failed to create context: ${name}`, error);
      throw new Error(`Failed to create context: ${error.message}`);
    }
  }

  async deleteContext(name: string, password: string): Promise<void> {
    const contextPath = join(this.contextsPath, name);

    if (!existsSync(contextPath)) {
      throw new Error(`Context '${name}' not found`);
    }

    if (!(await this.validatePassword(name, password))) {
      throw new UnauthorizedException('Invalid password for context');
    }

    try {
      // Remove context directory
      await rm(contextPath, { recursive: true });

      // Update config file
      const config = await this.readConfig();
      config.contexts = config.contexts.filter((ctx) => ctx.name !== name);
      await this.writeConfig(config);

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
    password: string,
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

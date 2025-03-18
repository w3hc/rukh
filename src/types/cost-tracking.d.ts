import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

interface UserCosts {
  totalCosts: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  };
  requests: {
    timestamp: string;
    inputCost: number;
    outputCost: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
    message: string;
    sessionId: string;
    model: string;
  }[];
}

interface CostDatabase {
  users: {
    [walletAddress: string]: UserCosts;
  };
  global: {
    totalInputCost: number;
    totalOutputCost: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    modelsUsage: {
      [modelName: string]: {
        requests: number;
        inputTokens: number;
        outputTokens: number;
        cost: number;
      };
    };
    lastUpdated: string;
  };
}

@Injectable()
export class CostTracker implements OnModuleInit {
  private readonly logger = new Logger(CostTracker.name);
  private readonly dbPath: string;
  private data: CostDatabase;

  // Cost per 1K tokens in USD
  private readonly COST_RATES = {
    'mistral-large-2411': {
      inputCost: 0.015,
      outputCost: 0.075,
    },
    'claude-3-7-sonnet-20250219': {
      inputCost: 0.015,
      outputCost: 0.075,
    },
  };

  constructor() {
    this.dbPath = join(process.cwd(), 'data', 'costs.json');
    this.data = {
      users: {},
      global: {
        totalInputCost: 0,
        totalOutputCost: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequests: 0,
        modelsUsage: {},
        lastUpdated: new Date().toISOString(),
      },
    };
  }

  async onModuleInit() {
    try {
      // Create data directory if it doesn't exist
      const dataDir = join(process.cwd(), 'data');
      try {
        await fs.access(dataDir);
      } catch {
        await fs.mkdir(dataDir, { recursive: true });
      }

      // Initialize or load existing database
      try {
        await fs.access(this.dbPath);
        const content = await fs.readFile(this.dbPath, 'utf-8');
        const parsedData = JSON.parse(content);

        // Ensure modelsUsage exists (for backwards compatibility)
        if (!parsedData.global.modelsUsage) {
          parsedData.global.modelsUsage = {};
        }

        this.data = parsedData;
        this.logger.log('Cost tracking database loaded successfully');
      } catch (error) {
        // If file doesn't exist or is invalid, create with default data
        await this.saveData();
        this.logger.log('Created new cost tracking database');
      }
    } catch (error) {
      this.logger.error('Failed to initialize cost tracking database:', error);
    }
  }

  private async saveData(): Promise<void> {
    try {
      await fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      this.logger.error('Failed to save cost tracking database:', error);
    }
  }

  // Deprecated but kept for compatibility
  estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  // New method using actual token counts with fallback to estimates
  async trackUsageWithTokens(
    walletAddress: string,
    message: string,
    sessionId: string,
    modelName: string,
    inputText: string,
    outputText: string,
    inputTokens: number = 0,
    outputTokens: number = 0,
  ): Promise<void> {
    // If token counts are zero, use estimates
    if (inputTokens === 0) {
      inputTokens = this.estimateTokens(inputText);
    }
    if (outputTokens === 0) {
      outputTokens = this.estimateTokens(outputText);
    }
    try {
      // Skip tracking if no wallet address
      if (!walletAddress || walletAddress === '') {
        return;
      }

      // Get cost rates for the model
      const modelRates = this.COST_RATES[modelName] || {
        inputCost: 0.015,
        outputCost: 0.075,
      };

      // Calculate costs based on actual token counts
      const inputCost = Number(
        ((inputTokens / 1000) * modelRates.inputCost).toFixed(4),
      );
      const outputCost = Number(
        ((outputTokens / 1000) * modelRates.outputCost).toFixed(4),
      );
      const totalCost = Number((inputCost + outputCost).toFixed(4));

      // Initialize user data if it doesn't exist
      if (!this.data.users[walletAddress]) {
        this.data.users[walletAddress] = {
          totalCosts: {
            inputCost: 0,
            outputCost: 0,
            totalCost: 0,
            inputTokens: 0,
            outputTokens: 0,
          },
          requests: [],
        };
      }

      // Update user totals
      const user = this.data.users[walletAddress];
      user.totalCosts.inputCost += inputCost;
      user.totalCosts.outputCost += outputCost;
      user.totalCosts.totalCost += totalCost;
      user.totalCosts.inputTokens += inputTokens;
      user.totalCosts.outputTokens += outputTokens;

      // Add request to user history
      user.requests.push({
        timestamp: new Date().toISOString(),
        inputCost,
        outputCost,
        totalCost,
        inputTokens,
        outputTokens,
        message,
        sessionId,
        model: modelName,
      });

      // Update global totals
      this.data.global.totalInputCost += inputCost;
      this.data.global.totalOutputCost += outputCost;
      this.data.global.totalCost += totalCost;
      this.data.global.totalInputTokens += inputTokens;
      this.data.global.totalOutputTokens += outputTokens;
      this.data.global.totalRequests += 1;
      this.data.global.lastUpdated = new Date().toISOString();

      // Update model-specific usage statistics
      if (!this.data.global.modelsUsage[modelName]) {
        this.data.global.modelsUsage[modelName] = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        };
      }

      const modelStats = this.data.global.modelsUsage[modelName];
      modelStats.requests += 1;
      modelStats.inputTokens += inputTokens;
      modelStats.outputTokens += outputTokens;
      modelStats.cost += totalCost;

      // Save the updated data
      await this.saveData();
      this.logger.debug(
        `Tracked usage for ${walletAddress} with ${modelName}: $${totalCost.toFixed(4)} (${inputTokens} input tokens, ${outputTokens} output tokens)`,
      );
    } catch (error) {
      this.logger.error('Error tracking usage:', error);
    }
  }

  // Keep the old method for backward compatibility
  async trackUsage(
    walletAddress: string,
    message: string,
    sessionId: string,
    modelName: string,
    inputText: string,
    outputText: string,
  ): Promise<void> {
    // Estimate tokens (legacy method)
    const inputTokens = this.estimateTokens(inputText);
    const outputTokens = this.estimateTokens(outputText);

    // Call the newer method with estimated tokens
    await this.trackUsageWithTokens(
      walletAddress,
      message,
      sessionId,
      modelName,
      inputText,
      outputText,
      inputTokens,
      outputTokens,
    );
  }

  // Add a method to generate usage reports
  async generateUsageReport(walletAddress?: string): Promise<any> {
    if (walletAddress) {
      // Return report for specific user
      return (
        this.data.users[walletAddress] || {
          message: 'No usage data found for this wallet address',
        }
      );
    } else {
      // Return global stats
      return {
        global: {
          totalRequests: this.data.global.totalRequests,
          totalCost: this.data.global.totalCost.toFixed(4),
          totalInputTokens: this.data.global.totalInputTokens,
          totalOutputTokens: this.data.global.totalOutputTokens,
          modelsBreakdown: this.data.global.modelsUsage,
          lastUpdated: this.data.global.lastUpdated,
        },
        totalUsers: Object.keys(this.data.users).length,
      };
    }
  }

  async ensureDataDirExists() {
    try {
      // Create data directory if it doesn't exist
      const dataDir = join(process.cwd(), 'data');
      try {
        await fs.access(dataDir);
        this.logger.debug('Data directory exists');
      } catch {
        this.logger.debug('Creating data directory');
        await fs.mkdir(dataDir, { recursive: true });
      }
    } catch (error) {
      this.logger.error('Failed to ensure data directory exists:', error);
    }
  }

  async loadData() {
    try {
      await this.ensureDataDirExists();

      try {
        await fs.access(this.dbPath);
        const content = await fs.readFile(this.dbPath, 'utf-8');
        this.data = JSON.parse(content);
        this.logger.debug('Successfully loaded costs data from file');
      } catch (error) {
        this.logger.warn(
          'Could not load costs data, using default data',
          error,
        );
        // Use default data structure
        this.data = {
          users: {},
          global: {
            totalInputCost: 0,
            totalOutputCost: 0,
            totalCost: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalRequests: 0,
            modelsUsage: {},
            lastUpdated: new Date().toISOString(),
          },
        };
        await this.saveData();
        this.logger.debug('Created new costs data file');
      }
    } catch (error) {
      this.logger.error('Failed to load costs data:', error);
    }
  }

  async saveData(): Promise<void> {
    try {
      await this.ensureDataDirExists();

      const dataStr = JSON.stringify(this.data, null, 2);
      this.logger.debug(`Writing data to ${this.dbPath}`);
      await fs.writeFile(this.dbPath, dataStr);
      this.logger.debug('Successfully saved costs data');
    } catch (error) {
      this.logger.error('Failed to save costs data:', error);
      // Try to log the data structure for debugging
      try {
        this.logger.debug('Current data structure:', JSON.stringify(this.data));
      } catch (e) {
        this.logger.error('Could not stringify data for debug logging');
      }
    }
  }
}

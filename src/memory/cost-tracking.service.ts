import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

interface CostDatabase {
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
    // Mistral rates
    'mistral-large-2411': {
      inputCost: 0.003, // $3 per million tokens = $0.003 per 1K tokens
      outputCost: 0.003, // $3 per million tokens = $0.003 per 1K tokens
    },
    // Claude 3.7 Sonnet rates
    'claude-3-7-sonnet-20250219': {
      inputCost: 0.003, // $3 per million tokens = $0.003 per 1K tokens
      outputCost: 0.015, // $15 per million tokens = $0.015 per 1K tokens
    },
    // Add other Claude models for completeness
    'claude-3-opus-20240229': {
      inputCost: 0.015, // $15 per million tokens = $0.015 per 1K tokens
      outputCost: 0.075, // $75 per million tokens = $0.075 per 1K tokens
    },
    'claude-3-sonnet-20240229': {
      inputCost: 0.003, // $3 per million tokens = $0.003 per 1K tokens
      outputCost: 0.015, // $15 per million tokens = $0.015 per 1K tokens
    },
    'claude-3-haiku-20240307': {
      inputCost: 0.0005, // $0.5 per million tokens = $0.0005 per 1K tokens
      outputCost: 0.0025, // $2.5 per million tokens = $0.0025 per 1K tokens
    },
  };

  constructor() {
    this.dbPath = join(process.cwd(), 'data', 'costs.json');
    this.data = {
      requests: [],
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
      await this.loadData();
      this.logger.log('Cost tracking database initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize cost tracking database:', error);
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
        this.logger.warn('Creating new costs data file');
        // Use default data structure
        this.data = {
          requests: [],
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

  estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  async trackUsageWithTokens(
    walletAddress: string, // Unused
    message: string,
    sessionId: string,
    modelName: string,
    inputText: string,
    outputText: string,
    inputTokens: number = 0,
    outputTokens: number = 0,
  ): Promise<void> {
    try {
      this.logger.debug(`Tracking usage for model: ${modelName}`);

      // If token counts are zero or invalid, use estimates
      if (!inputTokens || inputTokens <= 0) {
        inputTokens = this.estimateTokens(inputText);
        this.logger.debug(`Using estimated input tokens: ${inputTokens}`);
      }

      if (!outputTokens || outputTokens <= 0) {
        outputTokens = this.estimateTokens(outputText);
        this.logger.debug(`Using estimated output tokens: ${outputTokens}`);
      }

      // Make sure we have proper model rates
      const modelRates = this.COST_RATES[modelName] || {
        inputCost: 0.015,
        outputCost: 0.075,
      };
      this.logger.debug(`Using model rates: ${JSON.stringify(modelRates)}`);

      // Calculate costs based on token counts
      const inputCost = Number(
        ((inputTokens / 1000) * modelRates.inputCost).toFixed(4),
      );
      const outputCost = Number(
        ((outputTokens / 1000) * modelRates.outputCost).toFixed(4),
      );
      const totalCost = Number((inputCost + outputCost).toFixed(4));

      this.logger.debug(
        `Calculated costs: input=$${inputCost}, output=$${outputCost}, total=$${totalCost}`,
      );

      // Add request to history
      this.data.requests.push({
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

      // Initialize modelsUsage if it doesn't exist
      if (!this.data.global.modelsUsage) {
        this.data.global.modelsUsage = {};
      }

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
        `Successfully tracked usage with ${modelName}: $${totalCost.toFixed(4)} (${inputTokens} input tokens, ${outputTokens} output tokens)`,
      );
    } catch (error) {
      this.logger.error('Error tracking usage:', error);
      // Try to log the state for debugging
      try {
        this.logger.debug(
          'Data state before error:',
          JSON.stringify(this.data),
        );
      } catch (e) {
        this.logger.error('Could not stringify data for error logging');
      }
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

  // Simple report that returns the exact format requested
  async generateUsageReport(): Promise<any> {
    // Return a direct reference to our data structure
    return this.data;
  }
}

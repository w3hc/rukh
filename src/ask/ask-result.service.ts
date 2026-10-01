import { Injectable, Logger } from '@nestjs/common';
import { AskDto } from '../dto/ask.dto';
import { AskResponseDto } from '../dto/ask-response.dto';
import { CostTracker } from '../memory/cost-tracking.service';
import { ProviderRegistry } from '../providers/provider-registry.service';

/**
 * What the streaming and non-streaming paths both do once a model has
 * answered: report the model, track usage, and assemble the response.
 */
@Injectable()
export class AskResultService {
  private readonly logger = new Logger(AskResultService.name);

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly costTracker: CostTracker,
  ) {}

  /** The public model name reported back for an internal model key. */
  modelLabel(model: string): string {
    return this.providers.get(model)?.label ?? model;
  }

  async trackUsage(
    askDto: AskDto,
    sessionId: string,
    usedModel: string,
    fullInput: string,
    fullOutput: string,
    usage: { input_tokens: number; output_tokens: number },
  ): Promise<void> {
    this.logger.debug(`Tracking usage for anonymous with model ${usedModel}`);
    this.logger.debug(
      `Token usage: input=${usage.input_tokens}, output=${usage.output_tokens}`,
    );

    try {
      await this.costTracker.trackUsageWithTokens(
        'anonymous',
        askDto.message,
        sessionId,
        usedModel,
        fullInput,
        fullOutput,
        usage.input_tokens,
        usage.output_tokens,
      );
      this.logger.debug('Usage tracking completed successfully');
    } catch (error) {
      this.logger.error('Failed to track usage:', error);
    }
  }

  /** Attaches the combined cost and the RAG metadata, when there are any. */
  complete(
    response: AskResponseDto,
    cost: any,
    ragMetadata: any,
  ): AskResponseDto {
    const combined = this.combineCost(cost, ragMetadata);
    if (combined) {
      response.cost = combined;
    }

    if (ragMetadata) {
      response.rag = ragMetadata;
      this.logger.log(
        `RAG metadata: ${ragMetadata.selectedFiles.length}/${ragMetadata.totalFilesAvailable} files used`,
      );
    }

    return response;
  }

  /** Adds the RAG selection cost onto the generation cost, when both exist. */
  private combineCost(cost: any, ragMetadata: any): any {
    if (!cost) {
      return undefined;
    }
    if (!ragMetadata?.selectionCost) {
      this.logger.log(
        `Request completed with cost: $${cost.total_cost.toFixed(6)} (input: $${cost.input_cost.toFixed(6)}, output: $${cost.output_cost.toFixed(6)})`,
      );
      return cost;
    }

    const selection = ragMetadata.selectionCost;
    const combinedCost = {
      ...cost,
      input_cost: Number((cost.input_cost + selection.input_cost).toFixed(6)),
      output_cost: Number(
        (cost.output_cost + selection.output_cost).toFixed(6),
      ),
      total_cost: Number((cost.total_cost + selection.total_cost).toFixed(6)),
    };

    this.logger.log(
      `Combined cost (selection + generation): $${combinedCost.total_cost.toFixed(6)} (input: $${combinedCost.input_cost.toFixed(6)}, output: $${combinedCost.output_cost.toFixed(6)})`,
    );
    return combinedCost;
  }
}

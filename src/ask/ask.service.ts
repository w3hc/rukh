import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AskDto } from '../dto/ask.dto';
import { AskResponseDto } from '../dto/ask-response.dto';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { StreamCost } from '../types/llm-stream';
import { AskPreparationService } from './ask-preparation.service';
import { AskResultService } from './ask-result.service';

/** Answers a request in one go, falling back across models on failure. */
@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly preparation: AskPreparationService,
    private readonly result: AskResultService,
  ) {}

  async ask(
    askDto: AskDto,
    file?: Express.Multer['File'],
  ): Promise<AskResponseDto> {
    let output: string | undefined;
    let usedSessionId = askDto.sessionId || randomUUID();
    let usedModel = 'none';
    let fullInput = '';
    let fullOutput = '';
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
    };
    let cost: StreamCost | undefined = undefined;

    try {
      const prepared = await this.preparation.prepare(askDto, file);
      const { modelsToTry, systemPrompt, ragMetadata, userMessage } = prepared;
      usedSessionId = prepared.sessionId;
      fullInput = prepared.fullInput;

      let lastError: Error | null = null;
      let modelProcessed = false;

      for (const currentModel of modelsToTry) {
        if (modelProcessed) {
          break;
        }

        try {
          this.logger.log(`Attempting to process with model: ${currentModel}`);

          this.logger.debug(
            `Using ${systemPrompt ? 'system prompt' : 'no system prompt'} with ${currentModel}`,
          );

          const provider = this.providers.get(currentModel);
          if (!provider) {
            this.logger.warn(`Unsupported model: ${currentModel}, skipping`);
            continue;
          }

          // Context travels in the system prompt, not in the message
          const response = await provider.ask(
            userMessage,
            usedSessionId,
            systemPrompt,
          );

          output = response.content;
          fullOutput = response.content;
          usedSessionId = response.sessionId;
          cost = response.cost;
          usedModel = this.result.modelLabel(currentModel);

          usage = response.usage || {
            input_tokens: Math.ceil(fullInput.length / 4), // Estimate if not provided
            output_tokens: Math.ceil(fullOutput.length / 4),
          };

          modelProcessed = true;
          this.logger.log(`Successfully processed with ${currentModel} model`);
        } catch (error) {
          this.logger.error(
            `Error processing with model ${currentModel}: ${error instanceof Error ? error.message : String(error)}`,
          );
          lastError = error as Error;
          this.logger.log(`Falling back to next model in sequence...`);
        }
      }

      if (!modelProcessed && lastError) {
        this.logger.error(
          `All models in fallback sequence failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
        );
      }

      if (output) {
        await this.result.trackUsage(
          askDto,
          usedSessionId,
          usedModel,
          fullInput,
          fullOutput,
          usage,
        );
      } else {
        this.logger.warn('Skipping usage tracking - no output was generated');
      }

      return this.result.complete(
        {
          output,
          model: usedModel,
          sessionId: usedSessionId,
          usage: usage,
        },
        cost,
        ragMetadata,
      );
    } catch (error) {
      this.logger.error(`Error in overall request processing:`, error);

      // Still return a response with available information
      return {
        output,
        model: usedModel,
        sessionId: usedSessionId,
        usage: usage,
      };
    }
  }
}

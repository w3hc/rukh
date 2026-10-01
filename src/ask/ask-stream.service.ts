import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AskDto } from '../dto/ask.dto';
import { AskStreamEvent } from '../dto/ask-stream.dto';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { ModelStreamEvent, StreamCost } from '../types/llm-stream';
import { AskPreparationService, PreparedAsk } from './ask-preparation.service';
import { AskResultService } from './ask-result.service';

/**
 * Streaming counterpart of {@link AskService}.
 *
 * Context loading and cost accounting are identical - only the delivery
 * differs: text is yielded as it is produced and the terminal `done` event
 * carries the very same response the non-streaming call would have returned.
 *
 * Model fallback still applies, but only up to the first byte: once text
 * has reached the client, silently restarting on another model would
 * duplicate the answer, so a later failure is surfaced as an `error` event
 * instead.
 */
@Injectable()
export class AskStreamService {
  private readonly logger = new Logger(AskStreamService.name);

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly preparation: AskPreparationService,
    private readonly result: AskResultService,
  ) {}

  async *askStream(
    askDto: AskDto,
    file?: Express.Multer['File'],
    signal?: AbortSignal,
  ): AsyncGenerator<AskStreamEvent> {
    let usedSessionId = askDto.sessionId || randomUUID();

    let prepared: PreparedAsk;
    try {
      prepared = await this.preparation.prepare(askDto, file);
      usedSessionId = prepared.sessionId;
    } catch (error) {
      this.logger.error(`Error preparing streamed request:`, error);
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
      return;
    }

    const { modelsToTry, systemPrompt, ragMetadata, fullInput, userMessage } =
      prepared;

    let lastError: Error | null = null;

    for (const currentModel of modelsToTry) {
      // Falling back for a client that has hung up just burns a second
      // model's tokens on an answer nobody will read
      if (signal?.aborted) {
        this.logger.log('Abandoning streamed request: client disconnected');
        return;
      }

      this.logger.log(`Attempting to stream with model: ${currentModel}`);

      let fullOutput = '';
      let emitted = false;
      let usage = { input_tokens: 0, output_tokens: 0 };
      let cost: StreamCost | undefined = undefined;
      let completed = false;

      try {
        for await (const event of this.streamFromModel(
          currentModel,
          userMessage, // Context travels in the system prompt, not here
          usedSessionId,
          systemPrompt,
          signal,
        )) {
          switch (event.type) {
            case 'text':
              emitted = true;
              fullOutput += event.text;
              yield { type: 'chunk', text: event.text };
              break;

            case 'thinking':
              // Passed through but not counted as output: it is not part of
              // the answer, and treating it as first-byte would disable the
              // model fallback before the answer has actually started
              yield { type: 'thinking', text: event.text };
              break;

            case 'reset':
              // The model discarded its own preamble; the client should too
              fullOutput = '';
              yield { type: 'reset' };
              break;

            case 'final':
              fullOutput = event.content;
              usedSessionId = event.sessionId;
              usage = event.usage;
              cost = event.cost;
              completed = true;
              break;
          }
        }
      } catch (error) {
        if (signal?.aborted) {
          this.logger.log(
            `Stream with ${currentModel} cancelled: client disconnected`,
          );
          return;
        }

        this.logger.error(
          `Error streaming with model ${currentModel}: ${error instanceof Error ? error.message : String(error)}`,
        );
        lastError = error as Error;

        if (emitted) {
          // Half an answer is already on the wire - falling back now would
          // splice a second answer onto it
          yield {
            type: 'error',
            message: `Stream interrupted: ${lastError.message}`,
          };
          return;
        }

        this.logger.log(`Falling back to next model in sequence...`);
        continue;
      }

      if (!completed) {
        if (signal?.aborted) {
          this.logger.log(
            `Stream with ${currentModel} cancelled: client disconnected`,
          );
          return;
        }

        this.logger.warn(
          `Model ${currentModel} ended its stream without a final event`,
        );
        lastError = new Error(`${currentModel} produced no final event`);
        if (!emitted) {
          continue;
        }
      }

      const usedModel = this.result.modelLabel(currentModel);

      // Fall back to the same 4-chars-per-token estimate the non-streaming
      // path uses when a provider reports no counts
      if (!usage.input_tokens && !usage.output_tokens) {
        usage = {
          input_tokens: Math.ceil(fullInput.length / 4),
          output_tokens: Math.ceil(fullOutput.length / 4),
        };
      }

      await this.result.trackUsage(
        askDto,
        usedSessionId,
        usedModel,
        fullInput,
        fullOutput,
        usage,
      );

      const response = this.result.complete(
        {
          output: fullOutput,
          model: usedModel,
          sessionId: usedSessionId,
          usage,
        },
        cost,
        ragMetadata,
      );

      this.logger.log(`Successfully streamed with ${currentModel} model`);
      yield { type: 'done', response };
      return;
    }

    this.logger.error(
      `All models in fallback sequence failed. Last error: ${lastError ? lastError.message : 'none reported'}`,
    );
    yield {
      type: 'error',
      message: lastError
        ? `All models failed. Last error: ${lastError.message}`
        : 'All models failed',
    };
  }

  /** Routes one model key to the matching provider's streaming generator. */
  private async *streamFromModel(
    model: string,
    message: string,
    sessionId: string,
    systemPrompt: string | undefined,
    signal?: AbortSignal,
  ): AsyncGenerator<ModelStreamEvent> {
    this.logger.debug(
      `Using ${systemPrompt ? 'system prompt' : 'no system prompt'} with ${model} (streaming)`,
    );

    const provider = this.providers.get(model);
    if (!provider) {
      throw new Error(`Unsupported model: ${model}`);
    }
    yield* provider.stream(message, sessionId, systemPrompt, signal);
  }
}

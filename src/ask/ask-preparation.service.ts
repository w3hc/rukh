import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AskDto } from '../dto/ask.dto';
import { RagMetadataDto } from '../dto/rag-metadata.dto';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { NOTIFIER, Notifier } from '../notifications/notifier';
import { ContextLoaderService } from './context-loader.service';
import { UploadService } from './upload.service';
import { delimitUserMessage } from './prompt-fencing';

export interface PreparedAsk {
  sessionId: string;
  modelsToTry: string[];
  /**
   * What goes in the system slot, or `undefined` when there is nothing to
   * send.
   *
   * It goes out on every turn. It used to be sent only on the first turn of
   * a session, on the assumption that later turns had it folded into the
   * stored history. They do not: the providers deliberately keep it out of
   * what they persist, so every follow-up message was running with no
   * context and no instructions at all - which showed up as the model
   * reverting to generic behaviour, or obeying instructions embedded in the
   * user's own pasted data, from the second message onwards.
   */
  systemPrompt?: string;
  ragMetadata?: RagMetadataDto;
  /** System prompt and user turn together, for cost tracking. */
  fullInput: string;
  /** The user turn as sent: fenced whenever there is a system prompt. */
  userMessage: string;
}

/**
 * Everything that has to happen before a model is called: model selection
 * and fallback ordering, context loading, and folding an uploaded file into
 * the system prompt.
 *
 * Shared by the streaming and non-streaming paths so the two cannot drift
 * apart on which context a request ends up seeing.
 */
@Injectable()
export class AskPreparationService {
  private readonly logger = new Logger(AskPreparationService.name);

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly contextLoader: ContextLoaderService,
    private readonly uploads: UploadService,
    @Optional() @Inject(NOTIFIER) private readonly notifier?: Notifier,
  ) {}

  async prepare(
    askDto: AskDto,
    file?: Express.Multer['File'],
  ): Promise<PreparedAsk> {
    const sessionId = askDto.sessionId || randomUUID();

    const contextName = askDto.context || 'rukh';

    if (!askDto.sessionId) {
      void this.notifier?.notify(
        'Rukh Ask',
        `Context: ${contextName || 'none'}\n\n${askDto.message}`,
      );
    }

    const modelsToTry = await this.selectModels(askDto, contextName);

    const loaded = await this.contextLoader.load(
      contextName,
      askDto.message,
      !!askDto.context,
    );
    let systemPrompt = loaded.systemPrompt;

    // The file is fenced off from the instructions that sit next to it there
    const fileSection = this.uploads.toSystemPromptSection(file);
    if (fileSection) {
      if (systemPrompt) {
        systemPrompt += '\n\n';
      }
      systemPrompt += fileSection;
    }

    // Delimited whenever there is a system prompt to defend, left untouched
    // otherwise
    const userMessage = systemPrompt
      ? delimitUserMessage(askDto.message)
      : askDto.message;

    const fullInput = systemPrompt
      ? systemPrompt + '\n\n' + userMessage
      : userMessage;

    return {
      sessionId,
      modelsToTry,
      systemPrompt: systemPrompt || undefined,
      ragMetadata: loaded.ragMetadata,
      fullInput,
      userMessage,
    };
  }

  private async selectModels(
    askDto: AskDto,
    contextName: string,
  ): Promise<string[]> {
    // A context can force a specific model via a `model` key in its
    // index.json. That takes precedence over the request's own model.
    const contextModelOverride =
      await this.contextLoader.getModelOverride(contextName);

    let selectedModel = contextModelOverride || askDto.model || 'anthropic';

    if (!this.providers.has(selectedModel)) {
      this.logger.warn(
        `Invalid model specified: ${selectedModel}, defaulting to mistral`,
      );
      selectedModel = 'mistral';
    }

    const modelsToTry = this.providers.fallbackChain(selectedModel);

    this.logger.log(
      `Processing request with models in fallback sequence: ${modelsToTry.join(', ')}`,
    );
    return modelsToTry;
  }
}

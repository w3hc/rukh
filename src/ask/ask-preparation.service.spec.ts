import { Logger } from '@nestjs/common';
import { AskPreparationService } from './ask-preparation.service';
import { ContextLoaderService } from './context-loader.service';
import { UploadService } from './upload.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { asLlmProvider } from '../providers/testing';
import { Notifier } from '../notifications/notifier';

describe('AskPreparationService', () => {
  let contextLoader: jest.Mocked<
    Pick<ContextLoaderService, 'getModelOverride' | 'load'>
  >;
  let notifier: jest.Mocked<Notifier>;
  let service: AskPreparationService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const providers = new ProviderRegistry([
      asLlmProvider('anthropic', {}),
      asLlmProvider('mistral', {}),
      asLlmProvider('anthropic-web-search', {}, { fallbackEligible: false }),
    ]);
    contextLoader = {
      getModelOverride: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue({ systemPrompt: 'Context prompt' }),
    };
    notifier = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new AskPreparationService(
      providers,
      contextLoader as unknown as ContextLoaderService,
      new UploadService(),
      notifier,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('models', () => {
    it('defaults to anthropic, then falls back', async () => {
      const { modelsToTry } = await service.prepare({ message: 'hi' });

      expect(modelsToTry).toEqual(['anthropic', 'mistral']);
    });

    it('uses the requested model first', async () => {
      const { modelsToTry } = await service.prepare({
        message: 'hi',
        model: 'mistral',
      });

      expect(modelsToTry).toEqual(['mistral', 'anthropic']);
    });

    it('lets the context override the requested model', async () => {
      contextLoader.getModelOverride.mockResolvedValue('anthropic-web-search');

      const { modelsToTry } = await service.prepare({
        message: 'hi',
        model: 'mistral',
        context: 'walkaway',
      });

      expect(contextLoader.getModelOverride).toHaveBeenCalledWith('walkaway');
      expect(modelsToTry[0]).toBe('anthropic-web-search');
    });

    it('defaults to mistral for an unknown model', async () => {
      const { modelsToTry } = await service.prepare({
        message: 'hi',
        model: 'not-a-real-model',
      });

      expect(modelsToTry[0]).toBe('mistral');
    });
  });

  describe('context', () => {
    it('loads the default context implicitly', async () => {
      await service.prepare({ message: 'hi' });

      expect(contextLoader.load).toHaveBeenCalledWith('rukh', 'hi', false);
    });

    it('marks a named context as explicit', async () => {
      await service.prepare({ message: 'hi', context: 'docs' });

      expect(contextLoader.load).toHaveBeenCalledWith('docs', 'hi', true);
    });

    it('passes the RAG metadata through', async () => {
      contextLoader.load.mockResolvedValue({
        systemPrompt: 'RAG prompt',
        ragMetadata: {
          selectedFiles: ['a.md'],
          totalFilesAvailable: 1,
          selectionMethod: 'rag-two-step',
        },
      });

      const { ragMetadata } = await service.prepare({ message: 'hi' });

      expect(ragMetadata).toEqual({
        selectedFiles: ['a.md'],
        totalFilesAvailable: 1,
        selectionMethod: 'rag-two-step',
      });
    });
  });

  describe('prompt', () => {
    it('fences the user turn when there is a system prompt', async () => {
      const prepared = await service.prepare({ message: 'hi' });

      expect(prepared.systemPrompt).toBe('Context prompt');
      expect(prepared.userMessage).toContain('<user_message>\nhi\n');
      expect(prepared.fullInput).toBe(
        `Context prompt\n\n${prepared.userMessage}`,
      );
    });

    it('leaves the user turn alone without a system prompt', async () => {
      contextLoader.load.mockResolvedValue({ systemPrompt: '' });

      const prepared = await service.prepare({ message: 'hi' });

      expect(prepared.systemPrompt).toBeUndefined();
      expect(prepared.userMessage).toBe('hi');
      expect(prepared.fullInput).toBe('hi');
    });

    it('appends a supported upload to the system prompt', async () => {
      const buffer = Buffer.from('a;b\n');

      const { systemPrompt } = await service.prepare({ message: 'hi' }, {
        originalname: 'x.csv',
        buffer,
        size: buffer.length,
      } as Express.Multer['File']);

      expect(systemPrompt).toMatch(
        /^Context prompt\n\nUploaded file \(x\.csv\)[\s\S]*<uploaded_file name="x.csv">\na;b\n/,
      );
    });
  });

  describe('session and notifications', () => {
    it('starts a session and notifies on a new conversation', async () => {
      const { sessionId } = await service.prepare({ message: 'hi' });

      expect(sessionId).toEqual(expect.any(String));
      expect(notifier.notify).toHaveBeenCalledWith(
        'Rukh Ask',
        'Context: rukh\n\nhi',
      );
    });

    it('keeps the session and stays quiet on a follow-up', async () => {
      const { sessionId } = await service.prepare({
        message: 'hi',
        sessionId: 'existing',
      });

      expect(sessionId).toBe('existing');
      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });
});

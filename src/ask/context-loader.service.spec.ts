import { Logger } from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContextLoaderService } from './context-loader.service';
import { RagService } from '../rag/rag.service';

describe('ContextLoaderService', () => {
  let cwd: string;
  let rag: jest.Mocked<
    Pick<RagService, 'selectRelevantFiles' | 'buildContextWithSelectedFiles'>
  >;
  let service: ContextLoaderService;

  const writeContext = (
    name: string,
    index: Record<string, unknown> | string,
    files: Record<string, string> = {},
  ) => {
    const dir = join(cwd, 'data', 'contexts', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'index.json'),
      typeof index === 'string' ? index : JSON.stringify(index),
    );
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(join(dir, file), content);
    }
    return dir;
  };

  const queries = (name: string) =>
    JSON.parse(
      readFileSync(join(cwd, 'data', 'contexts', name, 'index.json'), 'utf-8'),
    ).queries;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'context-loader-'));
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    rag = {
      selectRelevantFiles: jest.fn().mockResolvedValue({
        selectedFiles: ['a.md'],
        selectedUrls: ['https://example.com'],
        selectionCost: { input_cost: 0.1, output_cost: 0.2, total_cost: 0.3 },
      }),
      buildContextWithSelectedFiles: jest.fn().mockResolvedValue('RAG prompt'),
    };
    service = new ContextLoaderService(rag as unknown as RagService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('creates the contexts directory on init', async () => {
    await service.onModuleInit();

    expect(existsSync(join(cwd, 'data', 'contexts'))).toBe(true);
  });

  describe('getModelOverride', () => {
    it('reads the model from index.json', async () => {
      writeContext('forced', { model: 'mistral' });

      await expect(service.getModelOverride('forced')).resolves.toBe('mistral');
    });

    it('returns nothing for a missing or damaged index', async () => {
      writeContext('broken', '{"files":[]}\n  ]\n}');

      await expect(service.getModelOverride('missing')).resolves.toBe(
        undefined,
      );
      await expect(service.getModelOverride('broken')).resolves.toBe(undefined);
    });
  });

  describe('load', () => {
    it('returns an empty prompt without a context', async () => {
      await expect(service.load('', 'hi', false)).resolves.toEqual({
        systemPrompt: '',
      });
    });

    it('loads every markdown file and records the query', async () => {
      writeContext(
        'docs',
        { files: [{ name: 'a.md' }, { name: 'b.md' }] },
        { 'a.md': 'Alpha', 'b.md': 'Beta', 'README.md': 'skip me' },
      );

      const { systemPrompt, ragMetadata } = await service.load(
        'docs',
        'hi',
        false,
      );

      expect(systemPrompt).toContain('# Context: docs');
      expect(systemPrompt).toContain('### File: a.md\nAlpha');
      expect(systemPrompt).toContain('### File: b.md\nBeta');
      expect(systemPrompt).not.toContain('skip me');
      expect(ragMetadata).toBeUndefined();
      expect(rag.selectRelevantFiles).not.toHaveBeenCalled();
      expect(queries('docs')).toEqual([
        expect.objectContaining({
          origin: 'anon',
          message: 'hi',
          contextFilesUsed: ['a.md', 'b.md'],
        }),
      ]);
    });

    it('uses two-step RAG for an explicit context with several resources', async () => {
      writeContext('docs', {
        files: [{ name: 'a.md' }, { name: 'b.md' }],
        links: [{ url: 'https://example.com' }],
      });

      const { systemPrompt, ragMetadata } = await service.load(
        'docs',
        'hi',
        true,
      );

      expect(rag.selectRelevantFiles).toHaveBeenCalledWith('docs', 'hi', 5);
      expect(systemPrompt).toBe('RAG prompt');
      expect(ragMetadata).toEqual({
        selectedFiles: ['a.md'],
        selectedUrls: ['https://example.com'],
        totalFilesAvailable: 2,
        totalUrlsAvailable: 1,
        selectionMethod: 'rag-two-step',
        selectionCost: { input_cost: 0.1, output_cost: 0.2, total_cost: 0.3 },
      });
      expect(queries('docs')[0].contextFilesUsed).toEqual([
        'a.md',
        'link:https://example.com',
      ]);
    });

    it('skips RAG for an implicit context', async () => {
      writeContext(
        'rukh',
        { files: [{ name: 'a.md' }, { name: 'b.md' }] },
        { 'a.md': 'Alpha' },
      );

      await service.load('rukh', 'hi', false);

      expect(rag.selectRelevantFiles).not.toHaveBeenCalled();
    });

    it('falls back to every file when RAG fails', async () => {
      rag.selectRelevantFiles.mockRejectedValue(new Error('boom'));
      writeContext(
        'docs',
        { files: [{ name: 'a.md' }, { name: 'b.md' }] },
        { 'a.md': 'Alpha' },
      );

      const { systemPrompt, ragMetadata } = await service.load(
        'docs',
        'hi',
        true,
      );

      expect(systemPrompt).toContain('### File: a.md\nAlpha');
      expect(ragMetadata).toBeUndefined();
    });

    it('still loads files from a context with a damaged index', async () => {
      writeContext('broken', '{"files":[]}\n  ]\n}', { 'a.md': 'Alpha' });

      const { systemPrompt } = await service.load('broken', 'hi', true);

      expect(systemPrompt).toContain('### File: a.md\nAlpha');
    });

    it('keeps every record when queries land concurrently', async () => {
      writeContext('docs', { files: [] }, { 'a.md': 'Alpha' });

      await Promise.all(
        ['one', 'two', 'three'].map((m) => service.load('docs', m, false)),
      );

      // The queue guarantees no record is lost, not the order they land in
      expect(
        queries('docs')
          .map((q: { message: string }) => q.message)
          .sort(),
      ).toEqual(['one', 'three', 'two']);
    });
  });
});

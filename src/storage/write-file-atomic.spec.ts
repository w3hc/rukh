import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileAtomic } from './write-file-atomic';

describe('writeFileAtomic', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'write-file-atomic-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the file', async () => {
    const filePath = join(dir, 'data.json');
    await writeFileAtomic(filePath, '{"a":1}');
    expect(await readFile(filePath, 'utf-8')).toBe('{"a":1}');
  });

  it('replaces a longer file without leaving trailing bytes', async () => {
    const filePath = join(dir, 'data.json');
    await writeFile(filePath, '{"a":"a much longer value"}');
    await writeFileAtomic(filePath, '{"a":1}');
    expect(await readFile(filePath, 'utf-8')).toBe('{"a":1}');
  });

  it('leaves no temp file behind', async () => {
    await writeFileAtomic(join(dir, 'data.json'), '{}');
    expect(await readdir(dir)).toEqual(['data.json']);
  });

  it('keeps valid JSON under concurrent writes', async () => {
    const filePath = join(dir, 'data.json');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        writeFileAtomic(filePath, JSON.stringify({ i, pad: 'x'.repeat(i) })),
      ),
    );
    const content = await readFile(filePath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
    expect(await readdir(dir)).toEqual(['data.json']);
  });

  it('rejects and leaves nothing behind when the write fails', async () => {
    const target = join(dir, 'missing', 'data.json');
    await expect(writeFileAtomic(target, '{}')).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});

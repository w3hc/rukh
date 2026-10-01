import { randomUUID } from 'crypto';
import { rename, rm, writeFile } from 'fs/promises';

// Writes to a sibling temp file, then renames it over the target, so readers
// (including other processes) never see a partially written file.
export async function writeFileAtomic(
  filePath: string,
  data: string,
): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmpPath, data, 'utf-8');
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

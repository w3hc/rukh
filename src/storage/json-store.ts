import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';

export class JsonStore {
  private filePath: string;

  constructor(fileName: string) {
    this.filePath = join(process.cwd(), 'data', `${fileName}.json`);
  }

  async read<T>(): Promise<T> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {} as T;
    }
  }

  async write<T>(data: T): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}

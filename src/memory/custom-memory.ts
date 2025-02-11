import { BaseMemory } from '@langchain/core/memory';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

interface MemoryEntry {
  messages: {
    role: string;
    content: string;
    timestamp: number;
    sessionId: string;
  }[];
}

class JsonStore {
  private filePath: string;
  private dataDir: string;

  constructor(fileName: string) {
    this.dataDir = join(process.cwd(), 'data');
    this.filePath = join(this.dataDir, `${fileName}.json`);
  }

  async ensureDataDir() {
    if (!existsSync(this.dataDir)) {
      await mkdir(this.dataDir, { recursive: true });
    }
  }

  async read<T>(): Promise<T> {
    await this.ensureDataDir();
    try {
      const data = await readFile(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return { messages: [] } as T;
    }
  }

  async write<T>(data: T): Promise<void> {
    await this.ensureDataDir();
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }
}

export class CustomJsonMemory extends BaseMemory {
  private store: JsonStore;
  private sessionId: string;

  constructor(sessionId: string) {
    super();
    this.store = new JsonStore('chat-history');
    this.sessionId = sessionId;
  }

  get memoryKeys() {
    return ['history'];
  }

  async loadMemoryVariables(): Promise<{ history: MemoryEntry['messages'] }> {
    const history = await this.store.read<MemoryEntry>();
    const sessionMessages =
      history.messages?.filter((msg) => msg.sessionId === this.sessionId) || [];
    return { history: sessionMessages };
  }

  async saveContext(
    input: { input: string },
    output: { response: string },
  ): Promise<void> {
    const history = await this.store.read<MemoryEntry>();
    const messages = history.messages || [];

    messages.push({
      role: 'user',
      content: input.input,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });

    messages.push({
      role: 'assistant',
      content: output.response,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });

    await this.store.write({ messages });
  }
}

// Mock for @langchain/mistralai to avoid ESM issues with @mistralai/mistralai in Jest

export class ChatMistralAI {
  constructor() {}

  async invoke(): Promise<{ content: string }> {
    return { content: 'mocked response' };
  }

  async stream(): Promise<AsyncIterable<{ content: string }>> {
    return {
      async *[Symbol.asyncIterator]() {
        yield { content: 'mocked response' };
      },
    };
  }
}

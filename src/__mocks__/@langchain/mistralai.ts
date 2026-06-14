// Mock for @langchain/mistralai to avoid ESM issues with @mistralai/mistralai in Jest

export class ChatMistralAI {
  constructor() {}

  async invoke(): Promise<any> {
    return { content: 'mocked response' };
  }

  async stream(): Promise<any> {
    return {
      async *[Symbol.asyncIterator]() {
        yield { content: 'mocked response' };
      },
    };
  }
}

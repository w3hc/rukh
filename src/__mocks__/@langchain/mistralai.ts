// Mock for @langchain/mistralai to avoid ESM issues with @mistralai/mistralai in Jest

export class ChatMistralAI {
  constructor(_config?: any) {}

  async invoke(_input: any): Promise<any> {
    return { content: 'mocked response' };
  }

  async stream(_input: any): Promise<any> {
    return {
      async *[Symbol.asyncIterator]() {
        yield { content: 'mocked response' };
      }
    };
  }
}

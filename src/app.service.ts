import { Injectable } from '@nestjs/common';
import { MistralService } from './mistral/mistral.service';
import { AskResponseDto } from './dto/ask-response.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AppService {
  constructor(private readonly mistralService: MistralService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async ask(
    message: string,
    model?: string,
    sessionId?: string,
  ): Promise<AskResponseDto> {
    let output: string | undefined;
    let usedSessionId = sessionId || uuidv4();

    if (model === 'mistral') {
      const response = await this.mistralService.processMessage(
        message,
        usedSessionId,
      );
      output = response.content;
      usedSessionId = response.sessionId;
    }

    return {
      output,
      model: model === 'mistral' ? 'mistral-tiny' : 'none',
      network: 'mainnet',
      txHash:
        '0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
      sessionId: usedSessionId,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { MistralService } from './mistral/mistral.service';
import { AskResponseDto } from './dto/ask-response.dto';

@Injectable()
export class AppService {
  constructor(private readonly mistralService: MistralService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async ask(message: string, model?: string): Promise<AskResponseDto> {
    let output: string | undefined;

    if (model === 'mistral') {
      output = await this.mistralService.processMessage(message);
    }

    return {
      output,
      model: model === 'mistral' ? 'ministral-3b-2410' : 'none',
      network: 'mainnet',
      txHash:
        '0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
    };
  }
}

import { ApiProperty } from '@nestjs/swagger';

export class UsageDto {
  @ApiProperty({
    description: 'Number of input tokens used',
    example: 219,
  })
  input_tokens: number;

  @ApiProperty({
    description: 'Number of output tokens used',
    example: 147,
  })
  output_tokens: number;
}

export class AskResponseDto {
  @ApiProperty({
    description: 'The network used for processing',
    example: 'arbitrum-sepolia',
  })
  network: string;

  @ApiProperty({
    description: 'The model used for processing',
    example: 'mistral-large-2411',
  })
  model: string;

  @ApiProperty({
    description: 'The transaction hash',
    example:
      '0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
  })
  txHash: string;

  @ApiProperty({
    description: 'The explorer link for the transaction',
    example:
      'https://sepolia.arbiscan.io/tx/0x74a439e5a30952f4209037878f61e24949077e2285997a37798aee982651e84c',
  })
  explorerLink: string;

  @ApiProperty({
    description: 'The AI generated response',
    example: 'Generated response from the AI model',
    required: false,
  })
  output?: string;

  @ApiProperty({
    description: 'Session ID for conversation tracking',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  })
  sessionId: string;

  @ApiProperty({
    description: 'Token usage information',
    type: UsageDto,
    required: false,
  })
  usage?: UsageDto;
}

import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsEthereumAddress,
  ValidateIf,
} from 'class-validator';

export class AskDto {
  @ApiProperty({
    description: 'The message to send',
    example: 'Describe the app in three sentences max.',
    required: true,
  })
  @IsString()
  @IsNotEmpty({ message: 'Message is required' })
  message: string;

  @ApiProperty({
    description:
      'The model to use for processing. Use "mistral" for Mistral AI, "anthropic" for Anthropic Claude, or leave empty for no processing.',
    example: 'anthropic',
    required: false,
    default: 'mistral',
    enum: ['mistral', 'anthropic', ''],
  })
  @IsOptional()
  @IsIn(['mistral', 'anthropic', ''], {
    message: 'Model must be "mistral", "anthropic", or empty',
  })
  model?: string;

  @ApiProperty({
    description: 'Session ID for conversation continuity',
    example: '',
    required: false,
    nullable: true,
  })
  @IsOptional()
  sessionId?: string;

  @ApiProperty({
    description: 'Ethereum address to receive your RUKH governance token',
    example: '',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((o) => o.walletAddress !== '' && o.walletAddress !== undefined)
  @IsEthereumAddress()
  walletAddress?: string;

  @ApiProperty({
    description: 'Context to use for the conversation',
    example: '',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  context?: string;

  @ApiProperty({
    description: 'Additional data to be passed with the request',
    example: {
      githubUserName: 'julienbrg',
      nonce: '88888',
      signature: 'zzzzz',
    },
    required: false,
    nullable: true,
  })
  @IsOptional()
  data?: Record<string, any>;
}

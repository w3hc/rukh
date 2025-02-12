import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsEthereumAddress,
} from 'class-validator';

export class AskDto {
  @ApiProperty({
    description: 'The message to send',
    example: 'What is Rukh?',
    required: true,
  })
  @IsString()
  @IsNotEmpty({ message: 'Message is required' })
  message: string;

  @ApiProperty({
    description:
      'The model to use for processing. Use "mistral" to process the message with Mistral AI, or leave empty for no processing.',
    example: 'mistral',
    required: false,
    default: 'mistral',
    enum: ['mistral', ''],
  })
  @IsOptional()
  @IsIn(['mistral', ''], { message: 'Model must be either "mistral" or empty' })
  model?: string;

  @ApiProperty({
    description: 'Session ID for conversation continuity',
    example: '',
    required: false,
    default: '',
  })
  @IsOptional()
  sessionId?: string;

  @ApiProperty({
    description: 'Ethereum address to receive your RUKH governance token',
    example: '0x446200cB329592134989B615d4C02f9f3c9E970F',
    required: false,
  })
  @IsOptional()
  @IsEthereumAddress()
  walletAddress?: string;

  @ApiProperty({
    description: 'Context to use for the conversation',
    example: 'rukh',
    required: false,
    default: 'rukh',
  })
  @IsOptional()
  @IsString()
  context?: string;
}

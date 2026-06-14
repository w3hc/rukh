import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

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
      'The model to use for processing. Use "mistral" for Mistral AI, "anthropic" for Anthropic Claude, "openai" for OpenAI GPT-4o, or leave empty for no processing.',
    example: 'anthropic',
    required: false,
    default: 'mistral',
    enum: ['mistral', 'anthropic', 'openai', ''],
  })
  @IsOptional()
  @IsIn(['mistral', 'anthropic', 'openai', ''], {
    message: 'Model must be "mistral", "anthropic", "openai", or empty',
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
    description: 'Context to use for the conversation',
    example: '',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  context?: string;
}

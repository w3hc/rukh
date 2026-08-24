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
      'The model to use for processing. Use "mistral" for Mistral AI, "anthropic" for Anthropic Claude, "anthropic-web-search" for Anthropic Claude with server-side web search, "openai" for OpenAI GPT-4o, or leave empty for no processing.',
    example: 'anthropic',
    required: false,
    default: 'mistral',
    enum: ['mistral', 'anthropic', 'anthropic-web-search', 'openai', ''],
  })
  @IsOptional()
  @IsIn(['mistral', 'anthropic', 'anthropic-web-search', 'openai', ''], {
    message:
      'Model must be "mistral", "anthropic", "anthropic-web-search", "openai", or empty',
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

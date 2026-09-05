import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsBoolean,
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
      'The model to use for processing. Use "mistral" for Mistral AI, "anthropic" for Anthropic Claude, "anthropic-web-search" for Anthropic Claude with server-side web search, "openai" for OpenAI GPT-4o. Defaults to "anthropic" when omitted or empty. A context can pin its own model, which takes precedence over this field.',
    example: 'anthropic',
    required: false,
    default: 'anthropic',
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

  @ApiProperty({
    description:
      'Stream the answer back as server-sent events instead of a single JSON body. The response is then `text/event-stream`: `chunk` events carrying incremental text, an optional `reset` event (Anthropic web search only) telling the client to discard what it has rendered so far, and a final `done` event with the same payload as the non-streaming response.',
    example: false,
    required: false,
    default: false,
  })
  @IsOptional()
  // multipart/form-data carries every field as a string, so "true"/"false"
  // have to be folded into real booleans before validation
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() === 'true' : value,
  )
  @IsBoolean({ message: 'Stream must be a boolean' })
  stream?: boolean;
}

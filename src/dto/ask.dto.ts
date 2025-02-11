import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsUUID,
} from 'class-validator';

export class AskDto {
  @ApiProperty({
    description: 'The message to send',
    example: 'What is Rukh?',
  })
  @IsString()
  @IsNotEmpty({ message: 'Message is required' })
  message: string;

  @ApiProperty({
    description:
      'The model to use for processing. Use "mistral" to process the message with Mistral AI, or leave empty for no processing.',
    example: 'mistral',
    required: false,
    enum: ['mistral', ''],
  })
  @IsOptional()
  @IsIn(['mistral', ''], { message: 'Model must be either "mistral" or empty' })
  model?: string;

  @ApiProperty({
    description: 'Session ID for conversation continuity',
    example: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    required: false,
  })
  @IsOptional()
  @IsUUID(4, { message: 'Session ID must be a valid UUID v4' })
  sessionId?: string;
}

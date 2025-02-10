import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class AskDto {
  @ApiProperty({
    description: 'The message to send',
    example: 'What is the weather like today?',
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
}

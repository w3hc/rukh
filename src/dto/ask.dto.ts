import { ApiProperty } from '@nestjs/swagger';

export class AskDto {
  @ApiProperty({
    description: 'The message to send',
    example: 'What is the weather like today?',
  })
  message: string;

  @ApiProperty({
    description:
      'The model to use for processing. Use "mistral" to process the message with Mistral AI, or leave empty for no processing.',
    example: 'mistral',
    default: 'mistral',
    required: false,
    enum: ['mistral', ''],
    type: 'string',
  })
  model?: string;
}

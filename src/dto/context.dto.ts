import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class CreateContextDto {
  @ApiProperty({
    description: 'Name of the context to create',
    example: 'my-context',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message:
      'Context name can only contain lowercase letters, numbers, and hyphens',
  })
  name: string;
}

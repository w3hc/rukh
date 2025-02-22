import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class UploadContextFileDto {
  @ApiProperty({
    description: 'Name of the context to upload to',
    example: 'my-context',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message:
      'Context name can only contain lowercase letters, numbers, and hyphens',
  })
  contextName: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Markdown file to upload',
  })
  file: any;
}

export class DeleteFileDto {
  @ApiProperty({
    description: 'Name of the markdown file to delete (with .md extension)',
    example: 'my-context-file.md',
  })
  @IsString()
  @IsNotEmpty()
  filename: string;
}

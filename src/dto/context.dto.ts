import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsNumber,
  IsArray,
  IsUrl,
} from 'class-validator';

// Export these interfaces so they can be imported by other modules
export interface ContextFile {
  name: string;
  description: string;
  size: number;
}

export interface ContextLink {
  title: string;
  url: string;
  description?: string;
  timestamp: string;
}

export interface ContextQuery {
  timestamp: string;
  origin: string;
  contextFilesUsed: string[];
}

export interface ContextIndex {
  name: string;
  password: string;
  description: string;
  numberOfFiles: number;
  totalSize: number;
  files: ContextFile[];
  links: ContextLink[];
  queries: ContextQuery[];
}

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

  @ApiProperty({
    description: 'Password for the context',
    example: 'my-password',
  })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({
    description: 'Description of the context',
    example: 'Information about Ethereum, its roadmap, and EIPs',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;
}

export class ContextPasswordHeaderDto {
  @ApiProperty({
    description: 'Password for the context',
    example: 'my-password',
  })
  @IsString()
  @IsNotEmpty()
  'x-context-password': string;
}

export class ContextFileDto {
  @ApiProperty({
    description: 'Name of the file',
    example: 'best-practices.md',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Description of the file',
    example: 'Best practices for Ethereum development',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Size of the file in KB',
    example: 1,
  })
  @IsNumber()
  size: number;
}

export class ContextLinkDto {
  @ApiProperty({
    description: 'Title of the link',
    example: 'Rukh GitHub Repository',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'URL of the link',
    example: 'https://github.com/w3hc/rukh',
  })
  @IsUrl({}, { message: 'Invalid URL format' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'Description of the link (optional)',
    example: 'Official GitHub repository for the Rukh project',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;
}

export class ContextQueryDto {
  @ApiProperty({
    description: 'Timestamp of the query',
    example: '2021-09-01T12:00:00',
  })
  @IsString()
  timestamp: string;

  @ApiProperty({
    description: 'Origin of the query (usually a wallet address)',
    example: '0x...',
  })
  @IsString()
  origin: string;

  @ApiProperty({
    description: 'Context files used for the query',
    example: ['best-practices.md'],
  })
  @IsArray()
  contextFilesUsed: string[];
}

export class ContextMetadataDto {
  @ApiProperty({
    description: 'Name of the context',
    example: 'etherverse',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Description of the context',
    example: 'Information about Ethereum, its roadmap, and EIPs',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Number of files in the context',
    example: 4,
  })
  @IsNumber()
  numberOfFiles: number;

  @ApiProperty({
    description: 'Total size of all files in KB',
    example: 10,
  })
  @IsNumber()
  totalSize: number;

  @ApiProperty({
    description: 'Files in the context',
    type: [ContextFileDto],
  })
  @IsArray()
  files: ContextFileDto[];

  @ApiProperty({
    description: 'Links associated with the context',
    type: [ContextLinkDto],
  })
  @IsArray()
  links: ContextLinkDto[];

  @ApiProperty({
    description: 'Queries made to the context',
    type: [ContextQueryDto],
  })
  @IsArray()
  queries: ContextQueryDto[];
}

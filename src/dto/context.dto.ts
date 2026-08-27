import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsNumber,
  IsArray,
  IsUrl,
  IsIn,
} from 'class-validator';

// Models the `ask` endpoint accepts; kept in sync with AppService's
// availableModels list
export const CONTEXT_MODELS = [
  'mistral',
  'anthropic',
  'openai',
  'anthropic-web-search',
] as const;

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
  description: string;
  model?: string;
  creatorAddress: string;
  creatorName?: string;
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
    description: 'Description of the context',
    example: 'Information about Ethereum, its roadmap, and EIPs',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description:
      "Model this context forces on every /ask request against it, overriding the request's own model param. Omit to let the request choose.",
    example: 'anthropic-web-search',
    enum: CONTEXT_MODELS,
    required: false,
  })
  @IsIn(CONTEXT_MODELS)
  @IsOptional()
  model?: string;

  @ApiProperty({
    description:
      'Wallet address of the context creator. Must match the signer of the SIWE signature authorizing this request.',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'creatorAddress must be a valid Ethereum address',
  })
  creatorAddress: string;

  @ApiProperty({
    description: 'Display name of the context creator',
    example: 'Julien Béranger',
    required: false,
  })
  @IsString()
  @IsOptional()
  creatorName?: string;
}

export class SiweAuthHeadersDto {
  @ApiProperty({
    description: 'EIP-4361 SIWE message, statement scoped to this request',
    example:
      'example.com wants you to sign in with your Ethereum account:\n0x...',
  })
  @IsString()
  @IsNotEmpty()
  'x-siwe-message': string;

  @ApiProperty({
    description: 'Signature over the x-siwe-message value',
    example: '0x...',
  })
  @IsString()
  @IsNotEmpty()
  'x-siwe-signature': string;
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
    description: 'Origin of the query',
    example: 'anon',
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
    description: 'Wallet address of the context creator',
    example: '0x1234567890abcdef1234567890abcdef12345678',
    required: false,
  })
  @IsString()
  @IsOptional()
  creatorAddress?: string;

  @ApiProperty({
    description: 'Display name of the context creator',
    example: 'Julien Béranger',
    required: false,
  })
  @IsString()
  @IsOptional()
  creatorName?: string;

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

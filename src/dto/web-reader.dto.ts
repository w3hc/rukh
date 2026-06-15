import { IsUrl, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class WebReaderDto {
  @ApiProperty({
    description: 'The URL to fetch content from',
    example: 'https://julienberanger.com/',
  })
  @IsUrl({}, { message: 'Please provide a valid URL' })
  @IsNotEmpty({ message: 'URL is required' })
  url: string;

  @ApiProperty({
    description: 'Request timeout in milliseconds',
    required: false,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  timeout?: number;
}

export class WebSearchDto {
  @ApiProperty({
    description: 'Search query',
    example: 'NestJS documentation',
  })
  @IsNotEmpty({ message: 'Query is required' })
  query: string;

  @ApiProperty({
    description: 'Maximum number of results to return',
    required: false,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxResults?: number;
}

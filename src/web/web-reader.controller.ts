import { Controller, Get, Query, Logger, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { IsUrl, IsNotEmpty } from 'class-validator';
import { WebReaderService } from './web-reader.service';
import { Throttle } from '@nestjs/throttler';

class WebReaderDto {
  @IsUrl({}, { message: 'Please provide a valid URL' })
  @IsNotEmpty({ message: 'URL is required' })
  url: string;
}

@ApiTags('Web Reader')
@Controller('web-reader')
export class WebReaderController {
  private readonly logger = new Logger(WebReaderController.name);

  constructor(private readonly webReaderService: WebReaderService) {}

  @Get()
  @Throttle({ web: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Read raw HTML content from a webpage' })
  @ApiQuery({
    name: 'url',
    type: String,
    description: 'The URL to fetch content from',
    required: true,
    example: 'https://example.com',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the raw HTML content of the webpage',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL that was fetched',
        },
        content: {
          type: 'string',
          description: 'The HTML content of the webpage',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid URL format',
  })
  @ApiResponse({
    status: 502,
    description: 'Failed to fetch URL',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
  })
  async readWebPage(@Query(new ValidationPipe()) query: WebReaderDto) {
    this.logger.log(`Processing web read request for URL: ${query.url}`);
    return this.webReaderService.readWebPage(query.url);
  }

  @Get('llm')
  @Throttle({ web: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Extract text and links from a webpage for LLM processing',
  })
  @ApiQuery({
    name: 'url',
    type: String,
    description: 'The URL to fetch content from',
    required: true,
    example: 'https://julienberanger.com/',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the extracted content optimized for LLM processing',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL that was fetched',
        },
        title: {
          type: 'string',
          description: 'The title of the webpage',
        },
        text: {
          type: 'string',
          description: 'The extracted text content',
        },
        links: {
          type: 'array',
          description: 'List of links found on the page',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'Link text',
              },
              url: {
                type: 'string',
                description: 'Link URL',
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid URL format',
  })
  @ApiResponse({
    status: 502,
    description: 'Failed to fetch URL',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
  })
  async extractForLLM(@Query(new ValidationPipe()) query: WebReaderDto) {
    this.logger.log(`Processing LLM extraction request for URL: ${query.url}`);
    return this.webReaderService.extractForLLM(query.url);
  }
}

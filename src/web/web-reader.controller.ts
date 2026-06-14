import { Controller, Get, Query, Logger, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { IsUrl, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { WebReaderService } from './web-reader.service';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';

class WebReaderDto {
  @IsUrl({}, { message: 'Please provide a valid URL' })
  @IsNotEmpty({ message: 'URL is required' })
  url: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  timeout?: number;
}

class WebSearchDto {
  @IsNotEmpty({ message: 'Query is required' })
  query: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxResults?: number;
}

@ApiTags('Web Reader')
@Controller('web-reader')
export class WebReaderController {
  private readonly logger = new Logger(WebReaderController.name);

  constructor(private readonly webReaderService: WebReaderService) {}

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
  @ApiQuery({
    name: 'timeout',
    type: Number,
    description: 'Timeout in seconds (default: 3)',
    required: false,
    example: 3,
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
    return this.webReaderService.extractForLLM(query.url, query.timeout);
  }

  @Get('search')
  @Throttle({ web: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Perform a web search using Tavily API' })
  @ApiQuery({
    name: 'query',
    type: String,
    description: 'The search query',
    required: true,
    example: 'French law on data privacy',
  })
  @ApiQuery({
    name: 'maxResults',
    type: Number,
    description: 'Maximum number of results to return (default: 5, max: 10)',
    required: false,
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: 'Returns search results optimized for LLM processing',
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        answer: {
          type: 'string',
          description: 'AI-generated quick answer',
        },
        results: {
          type: 'array',
          description: 'Search results',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Page title',
              },
              url: {
                type: 'string',
                description: 'Page URL',
              },
              content: {
                type: 'string',
                description: 'Relevant content snippet',
              },
              score: {
                type: 'number',
                description: 'Relevance score',
              },
            },
          },
        },
        responseTime: {
          type: 'number',
          description: 'Time taken in milliseconds',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query',
  })
  @ApiResponse({
    status: 503,
    description: 'Web search not configured (TAVILY_API_KEY missing)',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
  })
  async search(@Query(new ValidationPipe()) query: WebSearchDto) {
    this.logger.log(`Processing web search request: "${query.query}"`);
    return this.webReaderService.search(query.query, query.maxResults);
  }
}

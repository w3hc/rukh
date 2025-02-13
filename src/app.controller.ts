import { Controller, Get, Post, Body, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { AskDto } from './dto/ask.dto';
import { AskResponseDto } from './dto/ask-response.dto';

@ApiTags('default')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @SkipThrottle()
  @Header('Content-Type', 'text/html')
  @ApiOperation({ summary: 'Get hello message' })
  @ApiResponse({
    status: 200,
    description: 'Returns a hello message',
    schema: {
      type: 'string',
      example: 'Hello World!',
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('ask')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  @ApiOperation({ summary: 'Send a message for processing' })
  @ApiResponse({
    status: 201,
    description: 'Message processed successfully',
    type: AskResponseDto,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit: 3 requests per hour',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 429 },
        message: {
          type: 'string',
          example: 'Rate limit exceeded. Maximum 3 requests allowed per hour.',
        },
      },
    },
  })
  async ask(@Body() askDto: AskDto): Promise<AskResponseDto> {
    return this.appService.ask(
      askDto.message,
      askDto.model,
      askDto.sessionId,
      askDto.walletAddress,
      askDto.context,
    );
  }
}

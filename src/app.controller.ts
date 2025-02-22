import { Controller, Get, Post, Body, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
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
  @ApiBody({
    description: 'Select an example request body.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        model: { type: 'string' },
        sessionId: { type: 'string' },
        walletAddress: { type: 'string' },
      },
    },
    examples: {
      Minimal: {
        summary: 'Minimal',
        description: 'Only the message field is provided.',
        value: {
          message: 'What is Rukh?',
        },
      },
      Complete: {
        summary: 'Complete',
        description:
          'Includes additional parameters like model, context, sessionId, and walletAddress.',
        value: {
          message: 'What is Rukh?',
          model: 'mistral',
          context: 'rukh',
          sessionId: '12345',
          walletAddress: '0xD8a394e7d7894bDF2C57139fF17e5CBAa29Dd977',
        },
      },
    },
  })
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

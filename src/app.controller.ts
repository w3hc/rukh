import {
  Controller,
  Get,
  Post,
  Body,
  Header,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiConsumes,
  ApiProperty,
} from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { AskDto } from './dto/ask.dto';
import { AskResponseDto } from './dto/ask-response.dto';
import { MarkdownFileValidator } from './validators/markdown-file.validator';

@ApiTags('Ask')
@Controller()
@SkipThrottle()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
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
  @Throttle({ ask: { limit: 50, ttl: 3600000 } })
  @ApiOperation({
    summary: 'Send a message for processing with optional markdown file upload',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Select an example request body.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Describe the app in three sentences max.',
        },
        model: {
          type: 'string',
          example: 'anthropic',
        },
        sessionId: {
          type: 'string',
          nullable: true,
          example: '',
        },
        walletAddress: {
          type: 'string',
          nullable: true,
          example: '',
        },
        context: {
          type: 'string',
          nullable: true,
          example: '',
        },
        data: {
          type: 'object',
          nullable: true,
          example: {
            githubUserName: 'julienbrg',
            nonce: '88888',
            signature: 'zzzzz',
          },
          description:
            'Additional data to be passed with the request (used in certain contexts)',
        },
        file: {
          type: 'string',
          format: 'binary',
          nullable: true,
          description:
            'Optional markdown file (.md) to include with the message',
        },
      },
      required: ['message'],
    },
    examples: {
      Minimal: {
        summary: 'Minimal',
        description: 'Only the message field is provided.',
        value: {
          message: 'Describe the app in three sentences max.',
        },
      },
      Complete: {
        summary: 'Complete',
        description:
          'Includes additional parameters like model, context, sessionId, and walletAddress.',
        value: {
          message: 'Describe the app in three sentences max.',
          model: 'anthropic',
          context: '',
          sessionId: '',
          walletAddress: '',
          data: {
            githubUserName: 'julienbrg',
            nonce: '88888',
            signature: 'zzzzz',
          },
        },
      },
      WithFile: {
        summary: 'With File',
        description: 'Includes a markdown file upload',
        value: {
          message: 'Analyze this document for me',
          model: 'anthropic',
        },
      },
      WithData: {
        summary: 'With Data',
        description: 'Includes additional data object',
        value: {
          message: 'Process this data for me',
          model: 'anthropic',
          data: {
            type: 'object',
            nullable: true,
            example: {
              githubUserName: 'julienbrg',
              nonce: '88888',
              signature: 'zzzzz',
            },
            description: 'Additional data to be passed with the request',
          },
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
    status: 400,
    description: 'Bad request or invalid file (only .md files are allowed)',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit: 50 requests per hour',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 429 },
        message: {
          type: 'string',
          example: 'Rate limit exceeded. Maximum 50 requests allowed per hour.',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async ask(
    @Body() askDto: AskDto,
    @UploadedFile(new MarkdownFileValidator({ optional: true }))
    file?: Express.Multer.File,
  ): Promise<AskResponseDto> {
    return this.appService.ask(
      askDto.message,
      askDto.model,
      askDto.sessionId,
      askDto.walletAddress,
      askDto.context,
      file,
      askDto.data,
    );
  }
}

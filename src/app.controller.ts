import {
  Controller,
  Get,
  Post,
  Body,
  Header,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';
import { AskDto } from './dto/ask.dto';
import { AskResponseDto } from './dto/ask-response.dto';
import { FileValidator } from './validators/file.validator';
import { RATE_LIMITS } from './config/rate-limit.config';

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
  @Throttle({ ask: RATE_LIMITS.ASK_ENDPOINT })
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
          example: "What's Rukh?",
        },
        model: {
          type: 'string',
          example: 'mistral',
        },
        sessionId: {
          type: 'string',
          nullable: true,
          example: '',
        },
        context: {
          type: 'string',
          nullable: true,
          example: 'rukh',
        },
        stream: {
          type: 'boolean',
          nullable: true,
          example: false,
          description:
            'Stream the answer as server-sent events instead of a single JSON body',
        },
        file: {
          type: 'string',
          format: 'binary',
          nullable: true,
          description:
            'Optional markdown (.md) or CSV (.csv) file to include with the message',
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
          'Includes additional parameters like model, context, and sessionId.',
        value: {
          message: 'Describe the app in three sentences max.',
          model: 'anthropic',
          context: '',
          sessionId: '',
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
      Streaming: {
        summary: 'Streaming',
        description:
          'Streams the answer back as text/event-stream instead of JSON.',
        value: {
          message: 'Describe the app in three sentences max.',
          model: 'anthropic',
          stream: true,
        },
      },
      WithWebSearch: {
        summary: 'With Web Search',
        description:
          'Uses Anthropic Claude with server-side web search enabled',
        value: {
          message: 'What are the latest developments in Ethereum scaling?',
          model: 'anthropic-web-search',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Message processed successfully. With `stream: true` the response is instead a `text/event-stream` of `chunk` events (`{ "text": "..." }`), an optional `reset` event telling the client to discard what it has rendered so far, and a terminal `done` event whose data is this same payload - or an `error` event if every model failed.',
    type: AskResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad request or invalid file (only .md and .csv files are allowed)',
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
    @Req() req: Request,
    // passthrough keeps Nest's normal serialization for the JSON path; only
    // the streaming branch writes to the response itself
    @Res({ passthrough: true }) res: Response,
    @UploadedFile(new FileValidator({ optional: true }))
    file?: Express.Multer['File'],
  ): Promise<AskResponseDto | void> {
    if (!askDto.stream) {
      return this.appService.ask(askDto, file);
    }

    return this.streamAsk(askDto, req, res, file);
  }

  /**
   * Writes an `askStream` run out as server-sent events.
   *
   * `X-Accel-Buffering: no` matters behind nginx, which otherwise buffers the
   * whole response and defeats the point of streaming.
   */
  private async streamAsk(
    askDto: AskDto,
    req: Request,
    res: Response,
    file?: Express.Multer['File'],
  ): Promise<void> {
    res.status(201);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let clientGone = false;
    req.on('close', () => {
      clientGone = true;
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const event of this.appService.askStream(askDto, file)) {
        if (clientGone) {
          // Breaking here returns the generator, which cancels the upstream
          // provider request instead of paying for tokens nobody will read
          break;
        }

        switch (event.type) {
          case 'chunk':
            send('chunk', { text: event.text });
            break;
          case 'reset':
            send('reset', {});
            break;
          case 'done':
            send('done', event.response);
            break;
          case 'error':
            send('error', { message: event.message });
            break;
        }
      }
    } catch (error) {
      // Headers are already sent, so the exception filter can't turn this
      // into a status code - report it in-band instead
      send('error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      res.end();
    }
  }
}

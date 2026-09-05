import {
  Controller,
  Get,
  Post,
  Body,
  Header,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
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

/**
 * How often to write a keep-alive comment on an open SSE stream.
 *
 * Well under nginx's 60s `proxy_read_timeout` default, so a long silent
 * reasoning phase never looks idle to whatever sits in front of this.
 */
const HEARTBEAT_INTERVAL_MS = 15000;

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
      'Message processed successfully. With `stream: true` the response is instead a `text/event-stream` of `chunk` events (`{ "text": "..." }`), `thinking` events carrying the model\'s reasoning rather than the answer (safe to ignore or render separately), an optional `reset` event telling the client to discard what it has rendered so far, and a terminal `done` event whose data is this same payload - or an `error` event if every model failed. Comment frames (`: ping`) arrive periodically to keep the connection alive; `EventSource` ignores them.',
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
    // passthrough keeps Nest's normal serialization for the JSON path; only
    // the streaming branch writes to the response itself
    @Res({ passthrough: true }) res: Response,
    @UploadedFile(new FileValidator({ optional: true }))
    file?: Express.Multer['File'],
  ): Promise<AskResponseDto | void> {
    if (!askDto.stream) {
      return this.appService.ask(askDto, file);
    }

    return this.streamAsk(askDto, res, file);
  }

  /**
   * Writes an `askStream` run out as server-sent events.
   *
   * `X-Accel-Buffering: no` matters behind nginx, which otherwise buffers the
   * whole response and defeats the point of streaming.
   *
   * Two things keep a long answer alive. The heartbeat writes an SSE comment
   * on a timer, because a model can reason for minutes before its first word
   * and a connection with no bytes on it is an idle connection to every proxy
   * in between - which cuts it. And the abort controller stops the upstream
   * request the moment the client goes away, rather than paying for an answer
   * to the end of a socket nobody is reading.
   */
  private async streamAsk(
    askDto: AskDto,
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
    const abort = new AbortController();

    // `res`, not `req`: a client that hangs up mid-answer closes the response,
    // and `writableFinished` is what separates that from our own normal end.
    res.on('close', () => {
      if (res.writableFinished) {
        return;
      }
      clientGone = true;
      abort.abort();
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // A comment frame: EventSource ignores it, proxies see a live connection
    const heartbeat = setInterval(() => {
      if (!clientGone && !res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    try {
      for await (const event of this.appService.askStream(
        askDto,
        file,
        abort.signal,
      )) {
        if (clientGone) {
          break;
        }

        switch (event.type) {
          case 'chunk':
            send('chunk', { text: event.text });
            break;
          case 'thinking':
            send('thinking', { text: event.text });
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
      if (!clientGone) {
        send('error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}

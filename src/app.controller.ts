import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { AskDto } from './dto/ask.dto';
import { AskResponseDto } from './dto/ask-response.dto';

@ApiTags('default')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
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
  @ApiOperation({ summary: 'Send a message for processing' })
  @ApiResponse({
    status: 201,
    description: 'Message processed successfully',
    type: AskResponseDto,
  })
  async ask(@Body() askDto: AskDto): Promise<AskResponseDto> {
    return this.appService.ask(askDto.message, askDto.model);
  }
}

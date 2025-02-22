import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ContextService } from './context.service';
import { CreateContextDto } from '../dto/context.dto';

@ApiTags('Context')
@Controller('context')
export class ContextController {
  constructor(private readonly contextService: ContextService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new context' })
  @ApiResponse({
    status: 201,
    description: 'Context created successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        path: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid context name or context already exists',
  })
  async createContext(@Body() createContextDto: CreateContextDto) {
    try {
      const result = await this.contextService.createContext(
        createContextDto.name,
      );
      return {
        message: 'Context created successfully',
        path: result,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Delete a context' })
  @ApiResponse({
    status: 200,
    description: 'Context deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async deleteContext(@Param('name') name: string) {
    try {
      await this.contextService.deleteContext(name);
      return {
        message: 'Context deleted successfully',
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }
}

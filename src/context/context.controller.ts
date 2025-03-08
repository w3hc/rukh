import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  HttpException,
  HttpStatus,
  Headers,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiHeader,
} from '@nestjs/swagger';
import { ContextService } from './context.service';
import { UploadContextFileDto, DeleteFileDto } from '../dto/upload-file.dto';
import { CreateContextDto } from '../dto/context.dto';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Context')
@Controller('context')
@SkipThrottle()
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
        createContextDto.password,
      );
      return {
        message: 'Context created successfully',
        path: result,
      };
    } catch (error) {
      if (error.message?.includes('already exists')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        error.message || 'Failed to create context',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload a markdown file to a context' })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({
    name: 'x-context-password',
    description: 'Password for the context',
    required: true,
  })
  @ApiBody({
    type: UploadContextFileDto,
  })
  @ApiResponse({
    status: 201,
    description: 'File uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        path: { type: 'string' },
        wasOverwritten: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request or invalid file type',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid password',
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Headers('x-context-password') password: string,
    @Body('contextName') contextName: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }), // 5MB
        ],
      }),
    )
    file: Express.MulterFile,
  ) {
    try {
      if (!password) {
        throw new BadRequestException('x-context-password header is required');
      }

      if (!file.originalname.toLowerCase().endsWith('.md')) {
        throw new BadRequestException('Only .md files are allowed');
      }

      const result = await this.contextService.uploadFile(
        contextName,
        file.originalname,
        file.buffer.toString('utf-8'),
        password,
      );

      return {
        message: result.wasOverwritten
          ? 'File updated successfully'
          : 'File uploaded successfully',
        path: result.path,
        wasOverwritten: result.wasOverwritten,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error.message?.includes('Context not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error.message || 'Failed to upload file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Delete a context' })
  @ApiHeader({
    name: 'x-context-password',
    description: 'Password for the context',
    required: true,
  })
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
    status: 400,
    description: 'Missing password header',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid password',
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async deleteContext(
    @Param('name') name: string,
    @Headers('x-context-password') password: string,
  ) {
    try {
      if (!password) {
        throw new BadRequestException('x-context-password header is required');
      }

      await this.contextService.deleteContext(name, password);
      return {
        message: 'Context deleted successfully',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error.message?.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error.message || 'Failed to delete context',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':name/file')
  @ApiOperation({ summary: 'Delete a markdown file from a context' })
  @ApiHeader({
    name: 'x-context-password',
    description: 'Password for the context',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'File deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Missing password header',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid password',
  })
  @ApiResponse({
    status: 404,
    description: 'Context or file not found',
  })
  async deleteFile(
    @Param('name') contextName: string,
    @Headers('x-context-password') password: string,
    @Body() deleteFileDto: DeleteFileDto,
  ) {
    try {
      if (!password) {
        throw new BadRequestException('x-context-password header is required');
      }

      await this.contextService.deleteFile(
        contextName,
        deleteFileDto.filename,
        password,
      );
      return {
        message: 'File deleted successfully',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error.message?.includes('not found')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        error.message || 'Failed to delete file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

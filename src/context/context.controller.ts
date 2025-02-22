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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { ContextService } from './context.service';
import { UploadContextFileDto, DeleteFileDto } from '../dto/upload-file.dto';
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

  @Post('upload')
  @ApiOperation({ summary: 'Upload a markdown file to a context' })
  @ApiConsumes('multipart/form-data')
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
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Body('contextName') contextName: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 1024 * 1024 }), // 1MB
        ],
      }),
    )
    file: Express.MulterFile,
  ) {
    try {
      if (!file.originalname.toLowerCase().endsWith('.md')) {
        throw new HttpException(
          'Only .md files are allowed',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.contextService.uploadFile(
        contextName,
        file.originalname,
        file.buffer.toString('utf-8'),
      );
      return {
        message: result.wasOverwritten
          ? 'File updated successfully'
          : 'File uploaded successfully',
        path: result.path,
        wasOverwritten: result.wasOverwritten,
      };
    } catch (error) {
      throw new HttpException(
        error.message,
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete(':name/file')
  @ApiOperation({ summary: 'Delete a markdown file from a context' })
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
  async deleteFile(
    @Param('name') contextName: string,
    @Body() deleteFileDto: DeleteFileDto,
  ) {
    try {
      await this.contextService.deleteFile(contextName, deleteFileDto.filename);
      return {
        message: 'File deleted successfully',
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }
}

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  Headers,
  BadRequestException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContextPasswordGuard } from '../guards/context-password.guard';
import { FILE_UPLOAD } from '../config/file-upload.config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiHeader,
  ApiParam,
} from '@nestjs/swagger';
import { ContextService } from './context.service';
import { UploadContextFileDto, DeleteFileDto } from '../dto/upload-file.dto';
import {
  CreateContextDto,
  ContextFileDto,
  ContextLink,
  ContextLinkDto,
} from '../dto/context.dto';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('Context')
@Controller('context')
@SkipThrottle()
export class ContextController {
  private readonly logger = new Logger(ContextController.name);

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
    const result = await this.contextService.createContext(
      createContextDto.name,
      createContextDto.password,
      createContextDto.description || '',
      createContextDto.model,
    );
    return {
      message: 'Context created successfully',
      path: result,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all available contexts' })
  @ApiResponse({
    status: 200,
    description: 'List of available contexts',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  })
  async listContexts() {
    return await this.contextService.listContexts();
  }

  @Get(':name/files')
  @UseGuards(ContextPasswordGuard)
  @ApiOperation({ summary: 'List files in a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiHeader({
    name: 'x-context-password',
    description: 'Password for the context',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'List of files in the context',
    type: [ContextFileDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid password',
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async listContextFiles(
    @Param('name') name: string,
    @Headers('x-context-password') password: string,
  ): Promise<ContextFileDto[]> {
    const files = await this.contextService.listContextFiles(name, password);
    // Convert ContextFile[] to ContextFileDto[] if needed
    return files.map((file) => ({
      name: file.name,
      description: file.description,
      size: file.size,
    }));
  }

  @Get(':name/file/:filename')
  @UseGuards(ContextPasswordGuard)
  @ApiOperation({ summary: 'Get file content from a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiParam({
    name: 'filename',
    description: 'Name of the file',
    required: true,
  })
  @ApiHeader({
    name: 'x-context-password',
    description: 'Password for the context',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'File content',
    schema: {
      type: 'string',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid password',
  })
  @ApiResponse({
    status: 404,
    description: 'Context or file not found',
  })
  async getFileContent(
    @Param('name') name: string,
    @Param('filename') filename: string,
    @Headers('x-context-password') password: string,
  ): Promise<string> {
    return await this.contextService.getFileContent(name, filename, password);
  }

  @Post('upload')
  @UseGuards(ContextPasswordGuard)
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
    @Body('fileDescription') fileDescription: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: FILE_UPLOAD.MAX_FILE_SIZE }),
        ],
      }),
    )
    file: Express.MulterFile,
  ) {
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));
    if (!FILE_UPLOAD.ALLOWED_EXTENSIONS.includes(fileExtension)) {
      throw new BadRequestException(
        `Only ${FILE_UPLOAD.ALLOWED_EXTENSIONS.join(', ')} files are allowed`,
      );
    }

    const result = await this.contextService.uploadFile(
      contextName,
      file.originalname,
      file.buffer.toString('utf-8'),
      password,
      fileDescription || '',
    );

    return {
      message: result.wasOverwritten
        ? 'File updated successfully'
        : 'File uploaded successfully',
      path: result.path,
      wasOverwritten: result.wasOverwritten,
    };
  }

  @Delete(':name')
  @UseGuards(ContextPasswordGuard)
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
    await this.contextService.deleteContext(name, password);
    return {
      message: 'Context deleted successfully',
    };
  }

  @Delete(':name/file')
  @UseGuards(ContextPasswordGuard)
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
    await this.contextService.deleteFile(
      contextName,
      deleteFileDto.filename,
      password,
    );
    return {
      message: 'File deleted successfully',
    };
  }

  @Post(':name/link')
  @UseGuards(ContextPasswordGuard)
  @ApiOperation({ summary: 'Add a link to a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiHeader({
    name: 'x-context-password',
    description: 'Password for the context',
    required: true,
  })
  @ApiBody({
    description: 'Link details',
    type: ContextLinkDto,
  })
  @ApiResponse({
    status: 201,
    description: 'Link added successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        link: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            description: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid password',
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async addLink(
    @Param('name') name: string,
    @Headers('x-context-password') password: string,
    @Body() linkDto: ContextLinkDto,
  ): Promise<{ success: boolean; link: ContextLink }> {
    return await this.contextService.addLink(name, linkDto, password);
  }

  @Get(':name/links')
  @UseGuards(ContextPasswordGuard)
  @ApiOperation({ summary: 'List links in a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiHeader({
    name: 'x-context-password',
    description: 'Password for the context',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'List of links in the context',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          description: { type: 'string' },
          timestamp: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid password',
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async listLinks(
    @Param('name') name: string,
    @Headers('x-context-password') password: string,
  ): Promise<ContextLink[]> {
    return await this.contextService.listLinks(name, password);
  }

  @Delete(':name/link')
  @UseGuards(ContextPasswordGuard)
  @ApiOperation({ summary: 'Delete a link from a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiHeader({
    name: 'x-context-password',
    description: 'Password for the context',
    required: true,
  })
  @ApiBody({
    description: 'URL of the link to delete',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL of the link to delete',
          example: 'https://github.com/w3hc/rukh',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Link deleted successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid password',
  })
  @ApiResponse({
    status: 404,
    description: 'Context or link not found',
  })
  async deleteLink(
    @Param('name') name: string,
    @Headers('x-context-password') password: string,
    @Body() body: { url: string },
  ): Promise<{ success: boolean; message: string }> {
    if (!body.url) {
      throw new BadRequestException('URL is required');
    }

    await this.contextService.deleteLink(name, body.url, password);
    return {
      success: true,
      message: 'Link deleted successfully',
    };
  }
}

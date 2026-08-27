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
  BadRequestException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SiweAuthGuard } from '../guards/siwe-auth.guard';
import { SiweAddress } from '../guards/siwe-address.decorator';
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

const SIWE_HEADERS = [
  {
    name: 'x-siwe-message',
    description:
      'EIP-4361 SIWE message whose statement is "Authorize <METHOD> <path>" for this exact request',
    required: true,
  },
  {
    name: 'x-siwe-signature',
    description: 'Signature over the x-siwe-message value',
    required: true,
  },
] as const;

@ApiTags('Context')
@Controller('context')
@SkipThrottle()
export class ContextController {
  private readonly logger = new Logger(ContextController.name);

  constructor(private readonly contextService: ContextService) {}

  @Post()
  @UseGuards(SiweAuthGuard)
  @ApiOperation({ summary: 'Create a new context' })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
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
  @ApiResponse({
    status: 401,
    description:
      'Invalid or missing SIWE signature, or signer does not match creatorAddress',
  })
  async createContext(
    @SiweAddress() signerAddress: string,
    @Body() createContextDto: CreateContextDto,
  ) {
    const result = await this.contextService.createContext(
      createContextDto.name,
      signerAddress,
      createContextDto.description || '',
      createContextDto.model,
      createContextDto.creatorAddress,
      createContextDto.creatorName,
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
          creatorAddress: { type: 'string' },
          creatorName: { type: 'string' },
        },
      },
    },
  })
  async listContexts() {
    return await this.contextService.listContexts();
  }

  @Get(':name/files')
  @UseGuards(SiweAuthGuard)
  @ApiOperation({ summary: 'List files in a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
  @ApiResponse({
    status: 200,
    description: 'List of files in the context',
    type: [ContextFileDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature or signer is not the context creator',
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async listContextFiles(
    @Param('name') name: string,
    @SiweAddress() signerAddress: string,
  ): Promise<ContextFileDto[]> {
    const files = await this.contextService.listContextFiles(
      name,
      signerAddress,
    );
    // Convert ContextFile[] to ContextFileDto[] if needed
    return files.map((file) => ({
      name: file.name,
      description: file.description,
      size: file.size,
    }));
  }

  @Get(':name/file/:filename')
  @UseGuards(SiweAuthGuard)
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
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
  @ApiResponse({
    status: 200,
    description: 'File content',
    schema: {
      type: 'string',
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature or signer is not the context creator',
  })
  @ApiResponse({
    status: 404,
    description: 'Context or file not found',
  })
  async getFileContent(
    @Param('name') name: string,
    @Param('filename') filename: string,
    @SiweAddress() signerAddress: string,
  ): Promise<string> {
    return await this.contextService.getFileContent(
      name,
      filename,
      signerAddress,
    );
  }

  @Post('upload')
  @UseGuards(SiweAuthGuard)
  @ApiOperation({ summary: 'Upload a markdown file to a context' })
  @ApiConsumes('multipart/form-data')
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
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
    description: 'Invalid signature or signer is not the context creator',
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @SiweAddress() signerAddress: string,
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
      signerAddress,
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
  @UseGuards(SiweAuthGuard)
  @ApiOperation({ summary: 'Delete a context' })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
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
    status: 401,
    description: 'Invalid signature or signer is not the context creator',
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async deleteContext(
    @Param('name') name: string,
    @SiweAddress() signerAddress: string,
  ) {
    await this.contextService.deleteContext(name, signerAddress);
    return {
      message: 'Context deleted successfully',
    };
  }

  @Delete(':name/file')
  @UseGuards(SiweAuthGuard)
  @ApiOperation({ summary: 'Delete a markdown file from a context' })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
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
    status: 401,
    description: 'Invalid signature or signer is not the context creator',
  })
  @ApiResponse({
    status: 404,
    description: 'Context or file not found',
  })
  async deleteFile(
    @Param('name') contextName: string,
    @SiweAddress() signerAddress: string,
    @Body() deleteFileDto: DeleteFileDto,
  ) {
    await this.contextService.deleteFile(
      contextName,
      deleteFileDto.filename,
      signerAddress,
    );
    return {
      message: 'File deleted successfully',
    };
  }

  @Post(':name/link')
  @UseGuards(SiweAuthGuard)
  @ApiOperation({ summary: 'Add a link to a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
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
    description: 'Invalid signature or signer is not the context creator',
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async addLink(
    @Param('name') name: string,
    @SiweAddress() signerAddress: string,
    @Body() linkDto: ContextLinkDto,
  ): Promise<{ success: boolean; link: ContextLink }> {
    return await this.contextService.addLink(name, linkDto, signerAddress);
  }

  @Get(':name/links')
  @UseGuards(SiweAuthGuard)
  @ApiOperation({ summary: 'List links in a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
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
    description: 'Invalid signature or signer is not the context creator',
  })
  @ApiResponse({
    status: 404,
    description: 'Context not found',
  })
  async listLinks(
    @Param('name') name: string,
    @SiweAddress() signerAddress: string,
  ): Promise<ContextLink[]> {
    return await this.contextService.listLinks(name, signerAddress);
  }

  @Delete(':name/link')
  @UseGuards(SiweAuthGuard)
  @ApiOperation({ summary: 'Delete a link from a context' })
  @ApiParam({
    name: 'name',
    description: 'Name of the context',
    required: true,
  })
  @ApiHeader(SIWE_HEADERS[0])
  @ApiHeader(SIWE_HEADERS[1])
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
    description: 'Invalid signature or signer is not the context creator',
  })
  @ApiResponse({
    status: 404,
    description: 'Context or link not found',
  })
  async deleteLink(
    @Param('name') name: string,
    @SiweAddress() signerAddress: string,
    @Body() body: { url: string },
  ): Promise<{ success: boolean; message: string }> {
    if (!body.url) {
      throw new BadRequestException('URL is required');
    }

    await this.contextService.deleteLink(name, body.url, signerAddress);
    return {
      success: true,
      message: 'Link deleted successfully',
    };
  }
}

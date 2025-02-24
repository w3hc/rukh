import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';

@Injectable()
export class MarkdownFileValidator implements PipeTransform {
  transform(value: Express.Multer.File, metadata: ArgumentMetadata) {
    if (!value) {
      return value;
    }

    if (!value.originalname.toLowerCase().endsWith('.md')) {
      throw new BadRequestException(
        'Only markdown (.md) files are allowed for processing with Mistral AI',
      );
    }

    const maxSize = 1024 * 1024; // 1MB
    if (value.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds the maximum allowed size (1MB)`,
      );
    }

    return value;
  }
}

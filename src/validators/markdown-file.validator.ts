import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';

interface MarkdownFileValidatorOptions {
  optional?: boolean;
}

@Injectable()
export class MarkdownFileValidator implements PipeTransform {
  private optional: boolean;

  constructor(options: MarkdownFileValidatorOptions = {}) {
    this.optional = options.optional || false;
  }

  transform(value: Express.Multer.File, metadata: ArgumentMetadata) {
    if (!value) {
      return this.optional ? undefined : value;
    }

    if (!value.originalname.toLowerCase().endsWith('.md')) {
      throw new BadRequestException(
        'Only markdown (.md) files are allowed for processing',
      );
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (value.size > maxSize) {
      throw new BadRequestException(
        `File size exceeds the maximum allowed size (5MB)`,
      );
    }

    return value;
  }
}

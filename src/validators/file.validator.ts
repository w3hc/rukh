import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';

interface FileValidatorOptions {
  optional?: boolean;
}

const ALLOWED_EXTENSIONS = ['.md', '.csv'];

@Injectable()
export class FileValidator implements PipeTransform {
  private optional: boolean;

  constructor(options: FileValidatorOptions = {}) {
    this.optional = options.optional || false;
  }

  transform(value: Express.Multer.File, metadata: ArgumentMetadata) {
    if (!value) {
      return this.optional ? undefined : value;
    }

    const filename = value.originalname.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) =>
      filename.endsWith(ext),
    );

    if (!hasValidExtension) {
      throw new BadRequestException(
        'Only markdown (.md) and CSV (.csv) files are allowed for processing',
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

import { Injectable, Logger } from '@nestjs/common';
import { delimitUploadedFile } from './prompt-fencing';

const ALLOWED_EXTENSIONS = ['.md', '.csv'];

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  /**
   * Turns an uploaded file into the fenced section appended to the system
   * prompt, or `undefined` when there is no file or its type is not
   * supported.
   */
  toSystemPromptSection(file?: Express.Multer['File']): string | undefined {
    if (!file) {
      return undefined;
    }

    const name = file.originalname.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      this.logger.warn(`Ignoring unsupported file: ${file.originalname}`);
      return undefined;
    }

    const { content, encoding } = this.decode(file.buffer);
    this.logger.log(
      `Processing uploaded file: ${file.originalname} (${file.size} bytes, decoded as ${encoding})`,
    );

    return delimitUploadedFile(file.originalname, content);
  }

  /**
   * Decodes an uploaded file, sniffing the encoding rather than assuming it.
   *
   * A `;`-separated CSV is an Excel export from Windows, and those are usually
   * cp1252 rather than UTF-8: decoded as UTF-8, `declarent` with an accent
   * arrives as mojibake, which the model then faithfully reproduces in its
   * answer. A UTF-8 decode that yields U+FFFD saw bytes that are not valid
   * UTF-8, and that is the signal to try cp1252 instead.
   *
   * The heuristic is not exact - some cp1252 text happens to be valid UTF-8 -
   * but it catches accented Latin text, which is the case that matters, and it
   * cannot do worse than the unconditional UTF-8 decode it replaces.
   */
  decode(buffer: Buffer): {
    content: string;
    encoding: 'utf-8' | 'windows-1252';
  } {
    // A BOM is not content; left in, it becomes a stray character at the head
    // of the first cell.
    const hasBom =
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf;
    const bytes = hasBom ? buffer.subarray(3) : buffer;

    const utf8 = new TextDecoder('utf-8').decode(bytes);
    if (!utf8.includes('�')) {
      return { content: utf8, encoding: 'utf-8' };
    }

    return {
      content: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'windows-1252',
    };
  }
}

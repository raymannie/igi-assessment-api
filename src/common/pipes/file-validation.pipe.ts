import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  PipeTransform,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { extname } from 'node:path';

/** SPEC.md §7. */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 5;

/**
 * mimetype -> the extensions that may legitimately carry it. Both are checked: a client
 * can label anything `image/png`, and renaming a script to `.png` is just as easy. Neither
 * check is sufficient alone, and neither proves the bytes are what they claim — that
 * would need content sniffing, which is out of scope for the prototype.
 */
const ACCEPTED: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
};

export const ACCEPTED_MIME_TYPES = Object.keys(ACCEPTED);

export interface FileValidationOptions {
  /** When true, an empty upload is a 400 rather than an empty array. */
  required?: boolean;
}

@Injectable()
export class FileValidationPipe implements PipeTransform<
  Express.Multer.File[] | undefined,
  Express.Multer.File[]
> {
  constructor(private readonly options: FileValidationOptions = {}) {}

  transform(files: Express.Multer.File[] | undefined): Express.Multer.File[] {
    const list = files ?? [];

    if (!list.length) {
      if (this.options.required) {
        throw new BadRequestException({
          message: 'At least one file is required',
          code: 'VALIDATION_ERROR',
        });
      }
      return [];
    }

    if (list.length > MAX_FILES_PER_UPLOAD) {
      throw new BadRequestException({
        message: `At most ${MAX_FILES_PER_UPLOAD} files may be uploaded at once`,
        code: 'VALIDATION_ERROR',
      });
    }

    for (const file of list) {
      this.assertAcceptable(file);
    }

    return list;
  }

  private assertAcceptable(file: Express.Multer.File): void {
    const extensions = ACCEPTED[file.mimetype];

    if (!extensions) {
      throw new UnsupportedMediaTypeException({
        message: `${file.originalname}: only PDF, JPEG and PNG files are accepted`,
        code: 'UNSUPPORTED_FILE_TYPE',
        details: [`received content type "${file.mimetype}"`],
      });
    }

    const extension = extname(file.originalname).toLowerCase();
    if (!extensions.includes(extension)) {
      throw new UnsupportedMediaTypeException({
        message: `${file.originalname}: file extension does not match its content type`,
        code: 'UNSUPPORTED_FILE_TYPE',
        details: [
          `content type "${file.mimetype}" expects ${extensions.join(' or ')}, got "${extension || 'none'}"`,
        ],
      });
    }

    // Multer's own limit normally stops an oversized file mid-stream; this catches the
    // case where the interceptor was configured without one.
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new PayloadTooLargeException({
        message: `${file.originalname}: files may be at most 5 MB`,
        code: 'FILE_TOO_LARGE',
      });
    }
  }
}

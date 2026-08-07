import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * `Types.ObjectId.isValid` also accepts any 12-character string, which would let
 * "hello world!" through and surface as a confusing cast error deeper down. The API only
 * ever hands out 24-character hex ids, so match that exactly.
 */
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
      throw new BadRequestException({
        message: 'Malformed identifier',
        code: 'VALIDATION_ERROR',
        details: [`"${String(value)}" is not a valid id`],
      });
    }
    return value;
  }
}

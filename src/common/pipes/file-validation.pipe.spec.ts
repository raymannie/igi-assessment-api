import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import {
  FileValidationPipe,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_UPLOAD,
} from './file-validation.pipe';

const file = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    originalname: 'report.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('x'),
    ...overrides,
  }) as Express.Multer.File;

describe('FileValidationPipe', () => {
  const pipe = new FileValidationPipe();
  const required = new FileValidationPipe({ required: true });

  describe('accepted types', () => {
    it.each([
      ['report.pdf', 'application/pdf'],
      ['scan.jpg', 'image/jpeg'],
      ['scan.jpeg', 'image/jpeg'],
      ['scan.png', 'image/png'],
      ['SHOUTING.PDF', 'application/pdf'],
    ])('accepts %s as %s', (originalname, mimetype) => {
      expect(pipe.transform([file({ originalname, mimetype })])).toHaveLength(
        1,
      );
    });
  });

  describe('rejected types', () => {
    it.each([
      ['virus.exe', 'application/x-msdownload'],
      ['sheet.xlsx', 'application/vnd.ms-excel'],
      ['notes.txt', 'text/plain'],
      ['movie.mp4', 'video/mp4'],
      ['archive.zip', 'application/zip'],
    ])('rejects %s (%s) as UNSUPPORTED_FILE_TYPE', (originalname, mimetype) => {
      expect(() => pipe.transform([file({ originalname, mimetype })])).toThrow(
        UnsupportedMediaTypeException,
      );
    });

    it('rejects a mimetype the client made up', () => {
      expect(() =>
        pipe.transform([
          file({ originalname: 'a.pdf', mimetype: 'application/nonsense' }),
        ]),
      ).toThrow(UnsupportedMediaTypeException);
    });
  });

  describe('extension must agree with the content type', () => {
    it('rejects an executable relabelled as a PNG', () => {
      // The whole point of checking both: the Content-Type header is the client's word.
      expect(() =>
        pipe.transform([
          file({ originalname: 'payload.exe', mimetype: 'image/png' }),
        ]),
      ).toThrow(UnsupportedMediaTypeException);
    });

    it('rejects a PDF extension carrying an image mimetype', () => {
      expect(() =>
        pipe.transform([
          file({ originalname: 'report.pdf', mimetype: 'image/png' }),
        ]),
      ).toThrow(UnsupportedMediaTypeException);
    });

    it('rejects a file with no extension at all', () => {
      expect(() =>
        pipe.transform([
          file({ originalname: 'report', mimetype: 'application/pdf' }),
        ]),
      ).toThrow(UnsupportedMediaTypeException);
    });

    it('rejects a double extension whose last part is wrong', () => {
      expect(() =>
        pipe.transform([
          file({ originalname: 'report.pdf.exe', mimetype: 'application/pdf' }),
        ]),
      ).toThrow(UnsupportedMediaTypeException);
    });

    it('carries the UNSUPPORTED_FILE_TYPE code', () => {
      try {
        pipe.transform([
          file({ originalname: 'a.exe', mimetype: 'image/png' }),
        ]);
        fail('expected a throw');
      } catch (error) {
        const response = (
          error as UnsupportedMediaTypeException
        ).getResponse() as {
          code: string;
        };
        expect(response.code).toBe('UNSUPPORTED_FILE_TYPE');
      }
    });
  });

  describe('size', () => {
    it('accepts a file exactly at the limit', () => {
      expect(
        pipe.transform([file({ size: MAX_FILE_SIZE_BYTES })]),
      ).toHaveLength(1);
    });

    it('rejects a file one byte over as FILE_TOO_LARGE', () => {
      try {
        pipe.transform([file({ size: MAX_FILE_SIZE_BYTES + 1 })]);
        fail('expected a throw');
      } catch (error) {
        expect(error).toBeInstanceOf(PayloadTooLargeException);
        const response = (error as PayloadTooLargeException).getResponse() as {
          code: string;
        };
        expect(response.code).toBe('FILE_TOO_LARGE');
      }
    });
  });

  describe('count', () => {
    it(`accepts ${MAX_FILES_PER_UPLOAD} files`, () => {
      const files = Array.from({ length: MAX_FILES_PER_UPLOAD }, () => file());
      expect(pipe.transform(files)).toHaveLength(MAX_FILES_PER_UPLOAD);
    });

    it('rejects more than the maximum', () => {
      const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, () =>
        file(),
      );
      expect(() => pipe.transform(files)).toThrow(BadRequestException);
    });

    it('rejects the whole batch if any single file is bad', () => {
      expect(() =>
        pipe.transform([
          file(),
          file({ originalname: 'x.exe', mimetype: 'text/plain' }),
        ]),
      ).toThrow(UnsupportedMediaTypeException);
    });
  });

  describe('optional vs required', () => {
    it('allows no files when optional', () => {
      expect(pipe.transform(undefined)).toEqual([]);
      expect(pipe.transform([])).toEqual([]);
    });

    it('demands at least one when required', () => {
      expect(() => required.transform(undefined)).toThrow(BadRequestException);
      expect(() => required.transform([])).toThrow(BadRequestException);
    });
  });
});

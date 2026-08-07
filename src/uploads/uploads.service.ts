import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { UploadApiErrorResponse, UploadApiResponse } from 'cloudinary';

import { CLOUDINARY } from './cloudinary.provider';
// `import type` is required for a type used in a decorated constructor signature when
// isolatedModules and emitDecoratorMetadata are both on.
import type { CloudinaryApi } from './cloudinary.provider';

/** What a stored file looks like to the rest of the app — no Cloudinary types leak out. */
export interface StoredFile {
  url: string;
  publicId: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/** SPEC.md §7 — igi-portal/requests/{requestId}. */
export const folderForRequest = (requestId: string) =>
  `igi-portal/requests/${requestId}`;

/**
 * `resource_type: 'auto'` means Cloudinary decides where a file lands — PDFs go under
 * /raw/, images under /image/ — and `destroy` needs that same type to find it again. The
 * embedded Document in SPEC §5 has nowhere to record it, so deletion tries each in turn.
 */
const DESTROY_RESOURCE_TYPES = ['image', 'raw', 'video'] as const;

/** `result` is 'ok' or 'not found'. */
interface DestroyResponse {
  result: string;
}

/**
 * The only place the Cloudinary SDK is used. Everything else depends on this interface,
 * so swapping storage providers is a one-file change.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(@Inject(CLOUDINARY) private readonly cloudinary: CloudinaryApi) {}

  uploadFile(file: Express.Multer.File, folder: string): Promise<StoredFile> {
    return new Promise<StoredFile>((resolve, reject) => {
      const stream = this.cloudinary.uploader.upload_stream(
        {
          folder,
          // Without 'auto' a PDF would be rejected as a malformed image.
          resource_type: 'auto',
          use_filename: true,
          unique_filename: true,
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary upload failed for ${file.originalname}`,
              error?.message,
            );
            reject(
              new InternalServerErrorException({
                message: 'Could not store the uploaded file',
                code: 'INTERNAL_ERROR',
              }),
            );
            return;
          }

          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          });
        },
      );

      stream.end(file.buffer);
    });
  }

  /** Best-effort: used to clean up orphans when a multi-file upload fails partway. */
  async deleteFile(publicId: string): Promise<boolean> {
    for (const resourceType of DESTROY_RESOURCE_TYPES) {
      try {
        // The SDK types destroy() as returning `any`.
        const result = (await this.cloudinary.uploader.destroy(publicId, {
          resource_type: resourceType,
        })) as DestroyResponse;
        if (result.result === 'ok') return true;
      } catch (error) {
        this.logger.warn(
          `Failed to delete ${publicId} as ${resourceType}`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    this.logger.warn(`Could not delete ${publicId} under any resource type`);
    return false;
  }
}

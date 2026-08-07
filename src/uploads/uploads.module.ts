import { Module } from '@nestjs/common';

import { CloudinaryProvider } from './cloudinary.provider';
import { UploadsService } from './uploads.service';

@Module({
  providers: [CloudinaryProvider, UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}

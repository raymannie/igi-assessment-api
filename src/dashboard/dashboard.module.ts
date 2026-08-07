import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Request, RequestSchema } from '../requests/schemas/request.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Request.name, schema: RequestSchema }]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

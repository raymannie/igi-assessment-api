import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditModule } from '../audit/audit.module';
import { RequestOwnershipGuard } from '../common/guards/request-ownership.guard';
import { CountersService } from './counters.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { Request, RequestSchema } from './schemas/request.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Request.name, schema: RequestSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    AuditModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService, CountersService, RequestOwnershipGuard],
  exports: [RequestsService, MongooseModule],
})
export class RequestsModule {}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { RequestType } from '../common/types/request-type.enum';
import { Counter, CounterDocument } from './schemas/counter.schema';

const PREFIX: Record<RequestType, string> = {
  [RequestType.INSURANCE_CLAIM]: 'CLM',
  [RequestType.HMO_PRE_AUTHORIZATION]: 'PRE',
};

const SEQUENCE_WIDTH = 6;

@Injectable()
export class CountersService {
  constructor(
    @InjectModel(Counter.name)
    private readonly counterModel: Model<CounterDocument>,
  ) {}

  /**
   * `CLM-2026-000001` / `PRE-2026-000001`.
   *
   * The sequence comes from an atomic `$inc` with upsert, so concurrent creates can never
   * be handed the same number. Deriving it from `countDocuments()` would race, and would
   * also reuse numbers if a request were ever deleted.
   */
  async nextRequestNumber(
    requestType: RequestType,
    now = new Date(),
  ): Promise<string> {
    const prefix = PREFIX[requestType];
    const year = now.getUTCFullYear();
    const key = `${prefix}-${year}`;

    const counter = await this.counterModel
      .findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    const sequence = String(counter.seq).padStart(SEQUENCE_WIDTH, '0');
    return `${key}-${sequence}`;
  }
}

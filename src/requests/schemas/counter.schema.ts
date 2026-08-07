import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

/**
 * One document per `{prefix}-{year}` sequence, incremented atomically. Exists so
 * requestNumber generation never has to count existing documents — see CountersService.
 */
@Schema({ collection: 'counters' })
export class Counter {
  /** e.g. "CLM-2026" */
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true, default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);

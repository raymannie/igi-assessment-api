import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import {
  PRODUCT_CATEGORIES,
  ProductCategory,
} from '../../common/types/product-category.enum';
import {
  REQUEST_STATUSES,
  RequestStatus,
} from '../../common/types/request-status.enum';
import {
  REQUEST_TYPES,
  RequestType,
} from '../../common/types/request-type.enum';
import { User } from '../../users/schemas/user.schema';

/**
 * SPEC.md §5's embedded `Document`. Named RequestDocument here because `Document` is
 * Mongoose's own export — and note the hydrated type below is `HydratedRequest`, not
 * `RequestDocument`, to keep the two apart.
 */
@Schema({ _id: false })
export class RequestDocument {
  @Prop({ required: true })
  url: string;

  /** Cloudinary's id — kept so the file can be destroyed later. */
  @Prop({ required: true })
  publicId: string;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  uploadedBy: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  uploadedAt: Date;
}

export const RequestDocumentSchema =
  SchemaFactory.createForClass(RequestDocument);

export type HydratedRequest = HydratedDocument<Request>;

export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 2000;

@Schema({ timestamps: true, collection: 'requests' })
export class Request {
  @Prop({ required: true, unique: true })
  requestNumber: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  customer: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: User.name,
    default: null,
  })
  assignedOfficer: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: REQUEST_TYPES })
  requestType: RequestType;

  @Prop({ type: String, required: true, enum: PRODUCT_CATEGORIES })
  productCategory: ProductCategory;

  @Prop({ required: true, trim: true })
  policyNumber: string;

  @Prop({
    required: true,
    trim: true,
    minlength: DESCRIPTION_MIN,
    maxlength: DESCRIPTION_MAX,
  })
  description: string;

  @Prop({ required: true })
  incidentDate: Date;

  /** Required only for HMO_PRE_AUTHORIZATION — enforced by CreateRequestDto. */
  @Prop({ trim: true })
  serviceProvider?: string;

  @Prop({ required: true, min: 0.01 })
  estimatedAmount: number;

  @Prop({
    type: String,
    required: true,
    enum: REQUEST_STATUSES,
    default: RequestStatus.SUBMITTED,
  })
  status: RequestStatus;

  @Prop({ type: [RequestDocumentSchema], default: [] })
  documents: RequestDocument[];

  createdAt: Date;
  updatedAt: Date;
}

export const RequestSchema = SchemaFactory.createForClass(Request);

// SPEC.md §5 index list. `requestNumber` unique is declared on the @Prop above.
RequestSchema.index({ customer: 1, createdAt: -1 });
RequestSchema.index({
  status: 1,
  requestType: 1,
  productCategory: 1,
  createdAt: -1,
});
RequestSchema.index({ assignedOfficer: 1, status: 1 });
RequestSchema.index({
  requestNumber: 'text',
  description: 'text',
  policyNumber: 'text',
});

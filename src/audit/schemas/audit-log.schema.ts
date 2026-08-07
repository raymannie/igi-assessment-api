import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import {
  AUDIT_ACTIONS,
  AuditAction,
} from '../../common/types/audit-action.enum';
import {
  REQUEST_STATUSES,
  RequestStatus,
} from '../../common/types/request-status.enum';
import { USER_ROLES, UserRole } from '../../common/types/user-role.enum';
import { Request } from '../../requests/schemas/request.schema';
import { User } from '../../users/schemas/user.schema';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * SPEC.md §5. Its own collection rather than an embedded array: it grows without bound
 * per request, has its own timeline endpoint, and embedding would bloat every list query.
 *
 * Append-only — `updatedAt` is off, and neither AuditService nor any controller exposes
 * a way to modify or remove an entry.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'auditlogs',
})
export class AuditLog {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: Request.name,
    required: true,
  })
  request: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: User.name, required: true })
  actor: Types.ObjectId;

  /** Denormalised so the history stays truthful even if the user's role later changes. */
  @Prop({ type: String, required: true, enum: USER_ROLES })
  actorRole: UserRole;

  /** Snapshot of the actor's name at the time of the action, for the same reason. */
  @Prop({ required: true })
  actorName: string;

  @Prop({ type: String, required: true, enum: AUDIT_ACTIONS })
  action: AuditAction;

  @Prop({ type: String, enum: REQUEST_STATUSES })
  fromStatus?: RequestStatus;

  @Prop({ type: String, enum: REQUEST_STATUSES })
  toStatus?: RequestStatus;

  @Prop({ trim: true })
  comment?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, unknown>;

  createdAt: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// SPEC.md §5 — the timeline query is always "this request, oldest first".
AuditLogSchema.index({ request: 1, createdAt: 1 });

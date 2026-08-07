import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AuditAction } from '../common/types/audit-action.enum';
import { RequestStatus } from '../common/types/request-status.enum';
import { UserRole } from '../common/types/user-role.enum';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

export interface AuditEntryInput {
  request: Types.ObjectId;
  actor: Types.ObjectId;
  actorRole: UserRole;
  actorName: string;
  action: AuditAction;
  fromStatus?: RequestStatus;
  toStatus?: RequestStatus;
  comment?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The audit trail is append-only, so this service deliberately offers exactly one
 * mutating method and no way to update or delete. Callers are the services that perform
 * the mutation being recorded (CLAUDE.md pattern 2) — never a controller or interceptor.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async log(entry: AuditEntryInput): Promise<void> {
    await this.auditLogModel.create(entry);
  }

  /** Oldest first — the timeline reads top-to-bottom (SPEC.md §6). */
  findByRequest(requestId: string) {
    return this.auditLogModel
      .find({ request: new Types.ObjectId(requestId) })
      .sort({ createdAt: 1 })
      .populate('actor', 'fullName email')
      .lean()
      .exec();
  }
}

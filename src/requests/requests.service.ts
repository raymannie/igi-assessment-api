import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Model,
  QueryFilter,
  SortOrder as MongoSortOrder,
  Types,
} from 'mongoose';

import { AuditService } from '../audit/audit.service';
import { MAX_LIMIT } from '../common/dto/pagination-query.dto';
import { AuditAction } from '../common/types/audit-action.enum';
import { RequestStatus } from '../common/types/request-status.enum';
import { UserRole } from '../common/types/user-role.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { CountersService } from './counters.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { QueryRequestsDto } from './dto/query-requests.dto';
import { RespondDto } from './dto/respond.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import {
  assertCurrentStatus,
  assertOfficerTransition,
  assertTransition,
} from './request-state.machine';
import { HydratedRequest, Request } from './schemas/request.schema';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** The shape the TransformInterceptor turns into a paginated envelope. */
export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/** SPEC.md §5 — only ever expose these two fields of a referenced user. */
const USER_PROJECTION = 'fullName email';

@Injectable()
export class RequestsService {
  constructor(
    @InjectModel(Request.name)
    private readonly requestModel: Model<HydratedRequest>,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
  ) {}

  async create(customer: UserDocument, dto: CreateRequestDto) {
    const requestNumber = await this.countersService.nextRequestNumber(
      dto.requestType,
    );

    // Fields are listed explicitly rather than spread from the DTO. The global
    // ValidationPipe already strips unknown properties, but this way the service does not
    // depend on that: `status` and `assignedOfficer` can only ever come from the schema
    // defaults (SUBMITTED / null), whoever calls this and however they call it.
    const created = await this.requestModel.create({
      requestNumber,
      customer: customer._id,
      requestType: dto.requestType,
      productCategory: dto.productCategory,
      policyNumber: dto.policyNumber,
      description: dto.description,
      incidentDate: dto.incidentDate,
      serviceProvider: dto.serviceProvider,
      estimatedAmount: dto.estimatedAmount,
    });

    // CLAUDE.md pattern 2: the audit entry is written by the service that mutated, in
    // the same flow. A mutation without one is an incomplete feature.
    await this.auditService.log({
      request: created._id,
      actor: customer._id,
      actorRole: customer.role,
      actorName: customer.fullName,
      action: AuditAction.REQUEST_CREATED,
      toStatus: created.status,
      metadata: { requestNumber: created.requestNumber },
    });

    return this.findById(created._id.toString());
  }

  async findAll(
    user: UserDocument,
    query: QueryRequestsDto,
  ): Promise<Paginated<unknown>> {
    const filter = this.buildFilter(user, query);

    const limit = Math.min(query.limit, MAX_LIMIT);
    const page = query.page;
    const sort: Record<string, MongoSortOrder> = {
      [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1,
    };

    const [items, total] = await Promise.all([
      this.requestModel
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('customer', USER_PROJECTION)
        .populate('assignedOfficer', USER_PROJECTION)
        .lean()
        .exec(),
      this.requestModel.countDocuments(filter).exec(),
    ]);

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async findById(id: string) {
    const found = await this.requestModel
      .findById(id)
      .populate('customer', USER_PROJECTION)
      .populate('assignedOfficer', USER_PROJECTION)
      .lean()
      .exec();

    if (!found) {
      throw new NotFoundException({
        message: 'Request not found',
        code: 'NOT_FOUND',
      });
    }

    return found;
  }

  findAuditLogs(requestId: string) {
    return this.auditService.findByRequest(requestId);
  }

  /** SPEC §3: SUBMITTED -> ASSIGNED, and the officer claiming it becomes the assignee. */
  async assign(id: string, officer: UserDocument) {
    const current = await this.loadForMutation(id);

    if (current.assignedOfficer) {
      throw new ConflictException({
        message: 'This request is already assigned to an officer',
        code: 'INVALID_TRANSITION',
      });
    }

    assertTransition(current.status, RequestStatus.ASSIGNED);

    await this.applyTransition(
      id,
      current.status,
      RequestStatus.ASSIGNED,
      { assignedOfficer: officer._id },
      // Two officers hitting assign at once must not both win: the update only matches
      // while assignedOfficer is still null.
      { assignedOfficer: null },
    );

    await this.auditService.log({
      request: new Types.ObjectId(id),
      actor: officer._id,
      actorRole: officer.role,
      actorName: officer.fullName,
      action: AuditAction.REQUEST_ASSIGNED,
      fromStatus: current.status,
      toStatus: RequestStatus.ASSIGNED,
    });

    return this.findById(id);
  }

  /** SPEC §3: the officer-driven moves. Only the assignee may make them. */
  async updateStatus(id: string, officer: UserDocument, dto: UpdateStatusDto) {
    const current = await this.loadForMutation(id);

    this.assertIsAssignee(current.assignedOfficer, officer);
    assertOfficerTransition(current.status, dto.status, dto.comment);

    await this.applyTransition(id, current.status, dto.status);

    await this.auditService.log({
      request: new Types.ObjectId(id),
      actor: officer._id,
      actorRole: officer.role,
      actorName: officer.fullName,
      action: AuditAction.STATUS_CHANGED,
      fromStatus: current.status,
      toStatus: dto.status,
      comment: dto.comment,
    });

    return this.findById(id);
  }

  /**
   * SPEC §3: the customer answering a request for more information. The move back to
   * UNDER_REVIEW is automatic — the customer never names a status.
   */
  async respond(id: string, customer: UserDocument, dto: RespondDto) {
    const current = await this.loadForMutation(id);

    assertCurrentStatus(
      current.status,
      RequestStatus.NEEDS_ADDITIONAL_INFO,
      'responded to',
    );
    assertTransition(current.status, RequestStatus.UNDER_REVIEW);

    await this.applyTransition(id, current.status, RequestStatus.UNDER_REVIEW);

    await this.auditService.log({
      request: new Types.ObjectId(id),
      actor: customer._id,
      actorRole: customer.role,
      actorName: customer.fullName,
      action: AuditAction.CUSTOMER_RESPONDED,
      fromStatus: current.status,
      toStatus: RequestStatus.UNDER_REVIEW,
      comment: dto.message,
    });

    return this.findById(id);
  }

  /** SPEC §3/§11.8: WITHDRAWN is reachable only from NEEDS_ADDITIONAL_INFO. */
  async withdraw(id: string, customer: UserDocument) {
    const current = await this.loadForMutation(id);

    assertCurrentStatus(
      current.status,
      RequestStatus.NEEDS_ADDITIONAL_INFO,
      'withdrawn',
    );
    assertTransition(current.status, RequestStatus.WITHDRAWN);

    await this.applyTransition(id, current.status, RequestStatus.WITHDRAWN);

    await this.auditService.log({
      request: new Types.ObjectId(id),
      actor: customer._id,
      actorRole: customer.role,
      actorName: customer.fullName,
      action: AuditAction.REQUEST_WITHDRAWN,
      fromStatus: current.status,
      toStatus: RequestStatus.WITHDRAWN,
    });

    return this.findById(id);
  }

  /** The status and assignee are all any mutation needs to decide what is allowed. */
  private async loadForMutation(id: string) {
    const found = await this.requestModel
      .findById(id)
      .select('status assignedOfficer')
      .lean()
      .exec();

    if (!found) {
      throw new NotFoundException({
        message: 'Request not found',
        code: 'NOT_FOUND',
      });
    }

    return found;
  }

  /**
   * SPEC §3: only the assignee may drive a request forward. RolesGuard has already
   * established that the caller is *an* officer; this establishes they are *the* officer.
   */
  private assertIsAssignee(
    assignedOfficer: Types.ObjectId | null | undefined,
    officer: UserDocument,
  ): void {
    if (!assignedOfficer) {
      throw new ConflictException({
        message: 'This request has not been assigned to an officer yet',
        code: 'INVALID_TRANSITION',
      });
    }

    if (assignedOfficer.toString() !== officer._id.toString()) {
      throw new ForbiddenException({
        message: 'Only the assigned officer can change this request',
        code: 'FORBIDDEN',
      });
    }
  }

  /**
   * Writes the new status only while the document still holds the status we validated
   * against. Without that condition two concurrent requests could both pass
   * assertTransition against the same `from` and the second would overwrite the first —
   * e.g. APPROVED then DENIED, with an audit trail claiming both were legal.
   */
  private async applyTransition(
    id: string,
    from: RequestStatus,
    to: RequestStatus,
    set: Record<string, unknown> = {},
    extraConditions: Record<string, unknown> = {},
  ): Promise<void> {
    const updated = await this.requestModel
      .findOneAndUpdate(
        { _id: id, status: from, ...extraConditions },
        { $set: { status: to, ...set } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new ConflictException({
        message:
          'This request was changed by someone else; reload and try again',
        code: 'INVALID_TRANSITION',
      });
    }
  }

  /** One `$match` object built up front, rather than chained conditionals. */
  private buildFilter(
    user: UserDocument,
    query: QueryRequestsDto,
  ): QueryFilter<Request> {
    const filter: QueryFilter<Request> = {};

    // A customer can only ever see their own, whatever else they ask for.
    if (user.role === UserRole.CUSTOMER) {
      filter.customer = user._id;
    } else if (query.assignedToMe === 'true') {
      filter.assignedOfficer = user._id;
    }

    if (query.status?.length) filter.status = { $in: query.status };
    if (query.requestType) filter.requestType = query.requestType;
    if (query.productCategory) filter.productCategory = query.productCategory;

    const createdAt: { $gte?: Date; $lte?: Date } = {};
    if (query.dateFrom) createdAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) createdAt.$lte = endOfDay(new Date(query.dateTo));
    if (createdAt.$gte || createdAt.$lte) filter.createdAt = createdAt;

    if (query.search?.trim()) {
      filter.$text = { $search: query.search.trim() };
    }

    return filter;
  }
}

/** `dateTo=2026-12-31` should include everything that happened on the 31st. */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

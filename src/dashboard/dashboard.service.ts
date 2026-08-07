import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';

import {
  REQUEST_STATUSES,
  RequestStatus,
} from '../common/types/request-status.enum';
import { REQUEST_TYPES } from '../common/types/request-type.enum';
import { HydratedRequest, Request } from '../requests/schemas/request.schema';
import { DashboardStatsDto } from './dto/dashboard-stats.dto';

/** Each facet returns rows of this shape; `_id` is null for the whole-collection sums. */
interface Bucket {
  _id: string | null;
  value: number;
}

interface Facets {
  total: Bucket[];
  byStatus: Bucket[];
  byType: Bucket[];
  pendingAssignment: Bucket[];
  assignedToMe: Bucket[];
  totalEstimatedValue: Bucket[];
}

/** `$count` yields `[{ value: n }]`, or `[]` when nothing matched. */
const scalar = (rows: Bucket[]): number => rows[0]?.value ?? 0;

/**
 * Turns grouped rows into a complete map. Zero-filling from the enum matters: SPEC §6
 * shows every status as a key, so the dashboard can render a full set of tiles without
 * having to know which ones the API happened to omit.
 */
function tally<T extends string>(
  keys: readonly T[],
  rows: Bucket[],
): Record<T, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
    T,
    number
  >;

  for (const row of rows) {
    if (row._id !== null && row._id in counts) {
      counts[row._id as T] = row.value;
    }
  }

  return counts;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Request.name)
    private readonly requestModel: Model<HydratedRequest>,
  ) {}

  async getStats(officerId: Types.ObjectId): Promise<DashboardStatsDto> {
    // One `$facet` runs every branch over a single pass of the collection, rather than
    // six separate round trips that could also disagree with each other if a request
    // changed status between them.
    const pipeline: PipelineStage[] = [
      {
        $facet: {
          total: [{ $count: 'value' }],
          byStatus: [{ $group: { _id: '$status', value: { $sum: 1 } } }],
          byType: [{ $group: { _id: '$requestType', value: { $sum: 1 } } }],
          pendingAssignment: [
            { $match: { assignedOfficer: null } },
            { $count: 'value' },
          ],
          assignedToMe: [
            // Aggregation does not cast strings to ObjectId the way find() does — this
            // has to already be an ObjectId or the match silently returns nothing.
            { $match: { assignedOfficer: officerId } },
            { $count: 'value' },
          ],
          totalEstimatedValue: [
            { $group: { _id: null, value: { $sum: '$estimatedAmount' } } },
          ],
        },
      },
    ];

    const [facets] = await this.requestModel.aggregate<Facets>(pipeline).exec();

    const byStatus = tally(REQUEST_STATUSES, facets?.byStatus ?? []);

    return {
      totalRequests: scalar(facets?.total ?? []),
      byStatus,
      byType: tally(REQUEST_TYPES, facets?.byType ?? []),
      approvalRate: approvalRate(byStatus),
      pendingAssignment: scalar(facets?.pendingAssignment ?? []),
      assignedToMe: scalar(facets?.assignedToMe ?? []),
      totalEstimatedValue: scalar(facets?.totalEstimatedValue ?? []),
    };
  }
}

/**
 * Approved as a share of *decided* requests. Dividing by the total instead would make the
 * rate fall every time a new request is submitted, which reads as the team getting worse
 * at approving things when nothing about their decisions has changed.
 */
function approvalRate(byStatus: Record<RequestStatus, number>): number {
  const approved = byStatus[RequestStatus.APPROVED];
  const decided = approved + byStatus[RequestStatus.DENIED];

  if (decided === 0) return 0;

  // Four places is plenty, and keeps float noise out of the JSON.
  return Math.round((approved / decided) * 10_000) / 10_000;
}

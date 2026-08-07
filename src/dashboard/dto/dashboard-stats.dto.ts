import { ApiProperty } from '@nestjs/swagger';

import { RequestStatus } from '../../common/types/request-status.enum';
import { RequestType } from '../../common/types/request-type.enum';

/** SPEC.md §6 — the exact shape the frontend dashboard consumes. */
export class DashboardStatsDto {
  @ApiProperty({ example: 12 })
  totalRequests: number;

  @ApiProperty({
    description: 'Every status is present, including those with no requests.',
    example: {
      [RequestStatus.SUBMITTED]: 2,
      [RequestStatus.ASSIGNED]: 2,
      [RequestStatus.UNDER_REVIEW]: 2,
      [RequestStatus.NEEDS_ADDITIONAL_INFO]: 2,
      [RequestStatus.APPROVED]: 2,
      [RequestStatus.DENIED]: 1,
      [RequestStatus.WITHDRAWN]: 1,
    },
  })
  byStatus: Record<RequestStatus, number>;

  @ApiProperty({
    example: {
      [RequestType.INSURANCE_CLAIM]: 8,
      [RequestType.HMO_PRE_AUTHORIZATION]: 4,
    },
  })
  byType: Record<RequestType, number>;

  @ApiProperty({
    example: 0.6667,
    description:
      'Approved as a fraction of *decided* requests (approved + denied), 0 to 1. ' +
      'Requests still in flight are excluded, so the figure does not sag simply ' +
      'because new work has arrived. Zero when nothing has been decided yet.',
  })
  approvalRate: number;

  @ApiProperty({
    example: 2,
    description: 'Requests no officer has claimed yet.',
  })
  pendingAssignment: number;

  @ApiProperty({
    example: 5,
    description: 'Requests assigned to the calling officer, in any status.',
  })
  assignedToMe: number;

  @ApiProperty({
    example: 14675000,
    description: 'Sum of estimatedAmount across every request, in NGN.',
  })
  totalEstimatedValue: number;
}

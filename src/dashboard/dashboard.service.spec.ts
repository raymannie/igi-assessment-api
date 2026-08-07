import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { PipelineStage, Types } from 'mongoose';

import {
  REQUEST_STATUSES,
  RequestStatus,
} from '../common/types/request-status.enum';
import { REQUEST_TYPES, RequestType } from '../common/types/request-type.enum';
import { Request } from '../requests/schemas/request.schema';
import { DashboardService } from './dashboard.service';

const OFFICER_ID = new Types.ObjectId();

interface Facets {
  total: { _id: null; value: number }[];
  byStatus: { _id: string; value: number }[];
  byType: { _id: string; value: number }[];
  pendingAssignment: { _id: null; value: number }[];
  assignedToMe: { _id: null; value: number }[];
  totalEstimatedValue: { _id: null; value: number }[];
}

const EMPTY: Facets = {
  total: [],
  byStatus: [],
  byType: [],
  pendingAssignment: [],
  assignedToMe: [],
  totalEstimatedValue: [],
};

describe('DashboardService', () => {
  let service: DashboardService;
  let aggregate: jest.Mock;

  const respondWith = (facets: Partial<Facets>) =>
    aggregate.mockReturnValue({
      exec: () => Promise.resolve([{ ...EMPTY, ...facets }]),
    });

  const pipelineUsed = () =>
    (aggregate.mock.calls as unknown[][])[0][0] as PipelineStage[];

  const facetStage = () =>
    (pipelineUsed()[0] as { $facet: Record<string, PipelineStage[]> }).$facet;

  beforeEach(async () => {
    aggregate = jest
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve([{ ...EMPTY }]) });

    const moduleRef = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getModelToken(Request.name), useValue: { aggregate } },
      ],
    }).compile();

    service = moduleRef.get(DashboardService);
  });

  describe('the query', () => {
    it('runs exactly one aggregation', async () => {
      await service.getStats(OFFICER_ID);
      expect(aggregate).toHaveBeenCalledTimes(1);
    });

    it('does all the work inside a single $facet stage', async () => {
      await service.getStats(OFFICER_ID);
      const pipeline = pipelineUsed();

      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toHaveProperty('$facet');
    });

    it('covers every metric as its own facet', async () => {
      await service.getStats(OFFICER_ID);

      expect(Object.keys(facetStage()).sort()).toEqual([
        'assignedToMe',
        'byStatus',
        'byType',
        'pendingAssignment',
        'total',
        'totalEstimatedValue',
      ]);
    });

    it('matches assignedToMe on a real ObjectId, not a string', async () => {
      await service.getStats(OFFICER_ID);
      const [match] = facetStage().assignedToMe as [
        { $match: Record<string, unknown> },
      ];

      // Aggregation performs no casting — a string here would silently match nothing.
      expect(match.$match.assignedOfficer).toBeInstanceOf(Types.ObjectId);
      expect(match.$match.assignedOfficer).toEqual(OFFICER_ID);
    });

    it('treats pendingAssignment as "no officer claimed it"', async () => {
      await service.getStats(OFFICER_ID);
      const [match] = facetStage().pendingAssignment as [
        { $match: Record<string, unknown> },
      ];
      expect(match.$match).toEqual({ assignedOfficer: null });
    });
  });

  describe('an empty collection', () => {
    it('returns zeroes rather than undefined', async () => {
      const stats = await service.getStats(OFFICER_ID);

      expect(stats.totalRequests).toBe(0);
      expect(stats.pendingAssignment).toBe(0);
      expect(stats.assignedToMe).toBe(0);
      expect(stats.totalEstimatedValue).toBe(0);
      expect(stats.approvalRate).toBe(0);
    });

    it('still lists every status and type at zero', async () => {
      const stats = await service.getStats(OFFICER_ID);

      expect(Object.keys(stats.byStatus).sort()).toEqual(
        [...REQUEST_STATUSES].sort(),
      );
      expect(Object.values(stats.byStatus).every((n) => n === 0)).toBe(true);
      expect(Object.keys(stats.byType).sort()).toEqual(
        [...REQUEST_TYPES].sort(),
      );
    });

    it('survives the aggregation returning no documents at all', async () => {
      aggregate.mockReturnValue({ exec: () => Promise.resolve([]) });
      await expect(service.getStats(OFFICER_ID)).resolves.toMatchObject({
        totalRequests: 0,
      });
    });
  });

  describe('tallies', () => {
    it('zero-fills the statuses that have no requests', async () => {
      respondWith({
        byStatus: [
          { _id: RequestStatus.SUBMITTED, value: 3 },
          { _id: RequestStatus.APPROVED, value: 2 },
        ],
      });

      const stats = await service.getStats(OFFICER_ID);

      expect(stats.byStatus[RequestStatus.SUBMITTED]).toBe(3);
      expect(stats.byStatus[RequestStatus.APPROVED]).toBe(2);
      expect(stats.byStatus[RequestStatus.WITHDRAWN]).toBe(0);
      expect(Object.keys(stats.byStatus)).toHaveLength(REQUEST_STATUSES.length);
    });

    it('zero-fills request types', async () => {
      respondWith({ byType: [{ _id: RequestType.INSURANCE_CLAIM, value: 8 }] });

      const stats = await service.getStats(OFFICER_ID);
      expect(stats.byType[RequestType.INSURANCE_CLAIM]).toBe(8);
      expect(stats.byType[RequestType.HMO_PRE_AUTHORIZATION]).toBe(0);
    });

    it('ignores a bucket key that is not a known status', async () => {
      // Defends against stale documents written before an enum change.
      respondWith({
        byStatus: [
          { _id: 'LEGACY_STATUS', value: 99 },
          { _id: RequestStatus.DENIED, value: 1 },
        ],
      });

      const stats = await service.getStats(OFFICER_ID);
      expect(stats.byStatus).not.toHaveProperty('LEGACY_STATUS');
      expect(stats.byStatus[RequestStatus.DENIED]).toBe(1);
    });

    it('reads the scalar facets', async () => {
      respondWith({
        total: [{ _id: null, value: 12 }],
        pendingAssignment: [{ _id: null, value: 2 }],
        assignedToMe: [{ _id: null, value: 5 }],
        totalEstimatedValue: [{ _id: null, value: 14675000 }],
      });

      const stats = await service.getStats(OFFICER_ID);

      expect(stats.totalRequests).toBe(12);
      expect(stats.pendingAssignment).toBe(2);
      expect(stats.assignedToMe).toBe(5);
      expect(stats.totalEstimatedValue).toBe(14675000);
    });
  });

  describe('approvalRate', () => {
    const withDecisions = (approved: number, denied: number) =>
      respondWith({
        byStatus: [
          { _id: RequestStatus.APPROVED, value: approved },
          { _id: RequestStatus.DENIED, value: denied },
          { _id: RequestStatus.UNDER_REVIEW, value: 7 },
        ],
      });

    it('is approved over decided, ignoring work still in flight', async () => {
      withDecisions(2, 1);
      // 7 UNDER_REVIEW must not drag the rate down to 2/10.
      expect((await service.getStats(OFFICER_ID)).approvalRate).toBe(0.6667);
    });

    it('is 1 when everything decided was approved', async () => {
      withDecisions(4, 0);
      expect((await service.getStats(OFFICER_ID)).approvalRate).toBe(1);
    });

    it('is 0 when everything decided was denied', async () => {
      withDecisions(0, 3);
      expect((await service.getStats(OFFICER_ID)).approvalRate).toBe(0);
    });

    it('is 0 — not NaN — when nothing has been decided', async () => {
      withDecisions(0, 0);
      const rate = (await service.getStats(OFFICER_ID)).approvalRate;
      expect(rate).toBe(0);
      expect(Number.isNaN(rate)).toBe(false);
    });

    it('rounds to four decimal places', async () => {
      withDecisions(1, 2);
      expect((await service.getStats(OFFICER_ID)).approvalRate).toBe(0.3333);
    });

    it('does not count withdrawn requests as decisions', async () => {
      respondWith({
        byStatus: [
          { _id: RequestStatus.APPROVED, value: 1 },
          { _id: RequestStatus.DENIED, value: 1 },
          { _id: RequestStatus.WITHDRAWN, value: 8 },
        ],
      });
      expect((await service.getStats(OFFICER_ID)).approvalRate).toBe(0.5);
    });
  });
});

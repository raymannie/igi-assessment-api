import {
  REQUEST_STATUSES,
  RequestStatus,
} from '../common/types/request-status.enum';
import { RequestType } from '../common/types/request-type.enum';
import { UserRole } from '../common/types/user-role.enum';
import {
  assertCurrentStatus,
  assertOfficerTransition,
  assertTransition,
  isTerminal,
} from '../requests/request-state.machine';
import { SEED_REQUESTS, SEED_USERS, SeedRequest, SeedStep } from './seed-data';

/**
 * Replays a seed row against the state machine using the same calls RequestsService
 * makes, so bad seed data fails here rather than halfway through writing to production.
 */
function replay(spec: SeedRequest): RequestStatus {
  let status = RequestStatus.SUBMITTED;
  let assigned = false;

  const apply = (step: SeedStep) => {
    switch (step.action) {
      case 'assign':
        if (assigned) throw new Error('already assigned');
        assertTransition(status, RequestStatus.ASSIGNED);
        status = RequestStatus.ASSIGNED;
        assigned = true;
        return;

      case 'status':
        if (!assigned) throw new Error('status change before assignment');
        assertOfficerTransition(status, step.to, step.comment);
        status = step.to;
        return;

      case 'respond':
        assertCurrentStatus(
          status,
          RequestStatus.NEEDS_ADDITIONAL_INFO,
          'responded to',
        );
        assertTransition(status, RequestStatus.UNDER_REVIEW);
        status = RequestStatus.UNDER_REVIEW;
        return;

      case 'withdraw':
        assertCurrentStatus(
          status,
          RequestStatus.NEEDS_ADDITIONAL_INFO,
          'withdrawn',
        );
        assertTransition(status, RequestStatus.WITHDRAWN);
        status = RequestStatus.WITHDRAWN;
        return;

      case 'documents':
        if (isTerminal(status))
          throw new Error(`cannot upload to a ${status} request`);
        if (step.by === 'officer' && !assigned)
          throw new Error('no assignee to upload');
        return;
    }
  };

  spec.steps.forEach(apply);
  return status;
}

/** Every audit entry the replay would produce, in order. */
function auditTrailLength(spec: SeedRequest): number {
  // REQUEST_CREATED, then one entry per step.
  return 1 + spec.steps.length;
}

describe('seed users', () => {
  it('matches the four accounts SPEC §9 requires', () => {
    expect(SEED_USERS.map((u) => u.email).sort()).toEqual([
      'customer2@igi.test',
      'customer@igi.test',
      'officer2@igi.test',
      'officer@igi.test',
    ]);
  });

  it('seeds exactly two officers and two customers', () => {
    const byRole = (role: UserRole) =>
      SEED_USERS.filter((u) => u.role === role);
    expect(byRole(UserRole.OFFICER)).toHaveLength(2);
    expect(byRole(UserRole.CUSTOMER)).toHaveLength(2);
  });

  it('gives both customers a policy number and neither officer one', () => {
    for (const user of SEED_USERS) {
      if (user.role === UserRole.CUSTOMER) {
        expect(user.policyNumber).toBeTruthy();
      } else {
        expect(user.policyNumber).toBeUndefined();
      }
    }
  });

  it('uses passwords that satisfy the registration rules', () => {
    for (const user of SEED_USERS) {
      expect(user.password.length).toBeGreaterThanOrEqual(8);
      expect(user.password).toMatch(/[A-Za-z]/);
      expect(user.password).toMatch(/\d/);
    }
  });

  it('has a unique key per user', () => {
    expect(new Set(SEED_USERS.map((u) => u.key)).size).toBe(SEED_USERS.length);
  });
});

describe('seed requests', () => {
  it('seeds about a dozen requests', () => {
    expect(SEED_REQUESTS.length).toBeGreaterThanOrEqual(12);
  });

  it.each(
    SEED_REQUESTS.map((s, i) => [i, s.description.slice(0, 40), s] as const),
  )(
    'request %i (%s) replays legally to its expected status',
    (_index, _label, spec) => {
      expect(replay(spec)).toBe(spec.expectedStatus);
    },
  );

  it('covers all seven statuses', () => {
    const covered = new Set(SEED_REQUESTS.map((s) => s.expectedStatus));
    expect([...covered].sort()).toEqual([...REQUEST_STATUSES].sort());
  });

  it('covers both request types', () => {
    const covered = new Set(SEED_REQUESTS.map((s) => s.requestType));
    expect(covered.size).toBe(2);
  });

  it('covers several product categories', () => {
    const covered = new Set(SEED_REQUESTS.map((s) => s.productCategory));
    expect(covered.size).toBeGreaterThanOrEqual(4);
  });

  it('attaches documents to at least two requests', () => {
    const withDocuments = SEED_REQUESTS.filter((s) =>
      s.steps.some((step) => step.action === 'documents'),
    );
    expect(withDocuments.length).toBeGreaterThanOrEqual(2);
  });

  it('gives at least four requests a multi-step history', () => {
    // SPEC §9: "audit trails that look plausible (multi-step histories, not one entry each)".
    const multiStep = SEED_REQUESTS.filter((s) => auditTrailLength(s) >= 3);
    expect(multiStep.length).toBeGreaterThanOrEqual(4);
  });

  it('includes one request that walks the entire happy path', () => {
    const longest = Math.max(...SEED_REQUESTS.map(auditTrailLength));
    expect(longest).toBeGreaterThanOrEqual(6);
  });

  it('supplies serviceProvider for every HMO pre-authorization and no claim', () => {
    for (const spec of SEED_REQUESTS) {
      if (spec.requestType === RequestType.HMO_PRE_AUTHORIZATION) {
        expect(spec.serviceProvider).toBeTruthy();
      } else {
        expect(spec.serviceProvider).toBeUndefined();
      }
    }
  });

  it('uses descriptions that are unique — they are the idempotency key', () => {
    const descriptions = SEED_REQUESTS.map((s) => s.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('meets the schema rules for description length and amount', () => {
    for (const spec of SEED_REQUESTS) {
      expect(spec.description.length).toBeGreaterThanOrEqual(10);
      expect(spec.description.length).toBeLessThanOrEqual(2000);
      expect(spec.estimatedAmount).toBeGreaterThan(0);
    }
  });

  it('never dates an incident in the future', () => {
    for (const spec of SEED_REQUESTS) {
      expect(spec.incidentDaysAgo).toBeGreaterThan(0);
    }
  });

  it('supplies a comment on every transition that requires one', () => {
    for (const spec of SEED_REQUESTS) {
      for (const step of spec.steps) {
        if (
          step.action === 'status' &&
          (step.to === RequestStatus.NEEDS_ADDITIONAL_INFO ||
            step.to === RequestStatus.DENIED)
        ) {
          expect(step.comment?.trim()).toBeTruthy();
        }
      }
    }
  });
});

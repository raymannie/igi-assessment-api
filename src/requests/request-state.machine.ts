import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import { RequestStatus } from '../common/types/request-status.enum';
import { UserRole } from '../common/types/user-role.enum';

/**
 * SPEC.md §3. This file is the single source of truth for what may follow what.
 *
 * CLAUDE.md pattern 1: no status comparison logic may live anywhere else in the
 * codebase. If you need to ask a question about statuses, add a helper here.
 */
export const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.SUBMITTED]: [RequestStatus.ASSIGNED],
  [RequestStatus.ASSIGNED]: [RequestStatus.UNDER_REVIEW],
  [RequestStatus.UNDER_REVIEW]: [
    RequestStatus.NEEDS_ADDITIONAL_INFO,
    RequestStatus.APPROVED,
    RequestStatus.DENIED,
  ],
  [RequestStatus.NEEDS_ADDITIONAL_INFO]: [
    RequestStatus.UNDER_REVIEW,
    RequestStatus.WITHDRAWN,
  ],
  [RequestStatus.APPROVED]: [],
  [RequestStatus.DENIED]: [],
  [RequestStatus.WITHDRAWN]: [],
};

/** Moving *to* one of these without a comment is a 400. */
export const COMMENT_REQUIRED: RequestStatus[] = [
  RequestStatus.NEEDS_ADDITIONAL_INFO,
  RequestStatus.DENIED,
];

/** No transitions lead out of a terminal status. */
export function isTerminal(status: RequestStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function requiresComment(to: RequestStatus): boolean {
  return COMMENT_REQUIRED.includes(to);
}

/**
 * Throws unless `from -> to` is legal and any required comment is present.
 * Says nothing about *who* may perform the move — that is the guards' job.
 */
export function assertTransition(
  from: RequestStatus,
  to: RequestStatus,
  comment?: string,
): void {
  if (!canTransition(from, to)) {
    throw new ConflictException({
      message: isTerminal(from)
        ? `${from} is a terminal status; a request cannot leave it`
        : `Cannot move a request from ${from} to ${to}`,
      code: 'INVALID_TRANSITION',
    });
  }

  if (requiresComment(to) && !comment?.trim()) {
    throw new BadRequestException({
      message: `A comment is required when moving a request to ${to}`,
      code: 'COMMENT_REQUIRED',
    });
  }
}

const key = (from: RequestStatus, to: RequestStatus) => `${from}->${to}`;

/**
 * SPEC.md §3's "Actor" column. The table above says which moves are *possible*; this says
 * whose move each one is. The two customer-driven moves are reachable only through
 * POST /respond and POST /withdraw — §3 is explicit that NEEDS_ADDITIONAL_INFO ->
 * UNDER_REVIEW is "never set directly", so PATCH /status must refuse it even though
 * TRANSITIONS allows it.
 */
export const TRANSITION_ACTOR: Record<string, UserRole> = {
  [key(RequestStatus.SUBMITTED, RequestStatus.ASSIGNED)]: UserRole.OFFICER,
  [key(RequestStatus.ASSIGNED, RequestStatus.UNDER_REVIEW)]: UserRole.OFFICER,
  [key(RequestStatus.UNDER_REVIEW, RequestStatus.NEEDS_ADDITIONAL_INFO)]:
    UserRole.OFFICER,
  [key(RequestStatus.UNDER_REVIEW, RequestStatus.APPROVED)]: UserRole.OFFICER,
  [key(RequestStatus.UNDER_REVIEW, RequestStatus.DENIED)]: UserRole.OFFICER,
  [key(RequestStatus.NEEDS_ADDITIONAL_INFO, RequestStatus.UNDER_REVIEW)]:
    UserRole.CUSTOMER,
  [key(RequestStatus.NEEDS_ADDITIONAL_INFO, RequestStatus.WITHDRAWN)]:
    UserRole.CUSTOMER,
};

export function actorFor(
  from: RequestStatus,
  to: RequestStatus,
): UserRole | undefined {
  return TRANSITION_ACTOR[key(from, to)];
}

/**
 * The officer-facing entry point for PATCH /requests/:id/status. Rejects the
 * customer-driven moves before falling through to the ordinary legality checks.
 */
export function assertOfficerTransition(
  from: RequestStatus,
  to: RequestStatus,
  comment?: string,
): void {
  if (canTransition(from, to) && actorFor(from, to) === UserRole.CUSTOMER) {
    throw new ForbiddenException({
      message:
        to === RequestStatus.UNDER_REVIEW
          ? 'Only the customer can move a request out of NEEDS_ADDITIONAL_INFO; they do so by responding'
          : 'Only the customer can withdraw their own request',
      code: 'FORBIDDEN',
    });
  }

  assertTransition(from, to, comment);
}

/**
 * Guards an action that is only valid from one specific status — POST /respond and
 * POST /withdraw, both of which require NEEDS_ADDITIONAL_INFO.
 *
 * assertTransition alone is not enough for /respond: ASSIGNED -> UNDER_REVIEW is also a
 * legal move, so without this a customer could push an ASSIGNED request into review.
 */
export function assertCurrentStatus(
  actual: RequestStatus,
  expected: RequestStatus,
  action: string,
): void {
  if (actual !== expected) {
    throw new ConflictException({
      message: `A request can only be ${action} while it is ${expected}; this one is ${actual}`,
      code: 'INVALID_TRANSITION',
    });
  }
}

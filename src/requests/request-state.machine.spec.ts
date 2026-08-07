import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import { UserRole } from '../common/types/user-role.enum';

import {
  REQUEST_STATUSES,
  RequestStatus,
} from '../common/types/request-status.enum';
import {
  actorFor,
  assertCurrentStatus,
  assertOfficerTransition,
  assertTransition,
  canTransition,
  COMMENT_REQUIRED,
  isTerminal,
  TRANSITION_ACTOR,
  TRANSITIONS,
} from './request-state.machine';

const {
  SUBMITTED,
  ASSIGNED,
  UNDER_REVIEW,
  NEEDS_ADDITIONAL_INFO,
  APPROVED,
  DENIED,
  WITHDRAWN,
} = RequestStatus;

/** Every move SPEC.md §3's table allows. */
const LEGAL: [RequestStatus, RequestStatus][] = [
  [SUBMITTED, ASSIGNED],
  [ASSIGNED, UNDER_REVIEW],
  [UNDER_REVIEW, NEEDS_ADDITIONAL_INFO],
  [UNDER_REVIEW, APPROVED],
  [UNDER_REVIEW, DENIED],
  [NEEDS_ADDITIONAL_INFO, UNDER_REVIEW],
  [NEEDS_ADDITIONAL_INFO, WITHDRAWN],
];

const TERMINAL = [APPROVED, DENIED, WITHDRAWN];

/** The full cross-product minus the legal moves — everything that must be rejected. */
const ILLEGAL = REQUEST_STATUSES.flatMap((from) =>
  REQUEST_STATUSES.filter(
    (to) => !LEGAL.some(([lf, lt]) => lf === from && lt === to),
  ).map((to) => [from, to] as [RequestStatus, RequestStatus]),
);

const commentFor = (to: RequestStatus) =>
  COMMENT_REQUIRED.includes(to) ? 'a reason' : undefined;

describe('request state machine', () => {
  describe('table', () => {
    it('covers every status', () => {
      expect(Object.keys(TRANSITIONS).sort()).toEqual(
        [...REQUEST_STATUSES].sort(),
      );
    });

    it('allows exactly the transitions in SPEC §3', () => {
      const flattened = Object.entries(TRANSITIONS).flatMap(([from, tos]) =>
        tos.map((to) => `${from}->${to}`),
      );
      expect(flattened.sort()).toEqual(
        LEGAL.map(([f, t]) => `${f}->${t}`).sort(),
      );
    });

    it.each(TERMINAL)('treats %s as terminal', (status) => {
      expect(isTerminal(status)).toBe(true);
      expect(TRANSITIONS[status]).toEqual([]);
    });

    it.each([SUBMITTED, ASSIGNED, UNDER_REVIEW, NEEDS_ADDITIONAL_INFO])(
      'treats %s as non-terminal',
      (status) => {
        expect(isTerminal(status)).toBe(false);
      },
    );
  });

  describe('assertTransition — legal moves', () => {
    it.each(LEGAL)('permits %s -> %s', (from, to) => {
      expect(() => assertTransition(from, to, commentFor(to))).not.toThrow();
      expect(canTransition(from, to)).toBe(true);
    });
  });

  describe('assertTransition — illegal moves', () => {
    it.each(ILLEGAL)('rejects %s -> %s with INVALID_TRANSITION', (from, to) => {
      expect(() => assertTransition(from, to, 'a reason')).toThrow(
        ConflictException,
      );
      expect(canTransition(from, to)).toBe(false);
    });

    it('never lets a terminal status be revived', () => {
      // The single most important thing this table prevents.
      for (const from of TERMINAL) {
        for (const to of REQUEST_STATUSES) {
          expect(() => assertTransition(from, to, 'a reason')).toThrow(
            ConflictException,
          );
        }
      }
    });

    it('carries the INVALID_TRANSITION code in the payload', () => {
      try {
        assertTransition(APPROVED, UNDER_REVIEW);
        fail('expected a throw');
      } catch (error) {
        const response = (error as ConflictException).getResponse() as {
          code: string;
        };
        expect(response.code).toBe('INVALID_TRANSITION');
      }
    });

    it('rejects a self-transition', () => {
      expect(() => assertTransition(UNDER_REVIEW, UNDER_REVIEW, 'x')).toThrow(
        ConflictException,
      );
    });
  });

  describe('comment requirement', () => {
    it('requires exactly NEEDS_ADDITIONAL_INFO and DENIED', () => {
      expect([...COMMENT_REQUIRED].sort()).toEqual(
        [NEEDS_ADDITIONAL_INFO, DENIED].sort(),
      );
    });

    it.each([NEEDS_ADDITIONAL_INFO, DENIED])(
      'rejects a missing comment when moving to %s',
      (to) => {
        expect(() => assertTransition(UNDER_REVIEW, to)).toThrow(
          BadRequestException,
        );
      },
    );

    it.each([NEEDS_ADDITIONAL_INFO, DENIED])(
      'rejects a whitespace-only comment when moving to %s',
      (to) => {
        expect(() => assertTransition(UNDER_REVIEW, to, '   ')).toThrow(
          BadRequestException,
        );
      },
    );

    it('carries the COMMENT_REQUIRED code in the payload', () => {
      try {
        assertTransition(UNDER_REVIEW, DENIED);
        fail('expected a throw');
      } catch (error) {
        const response = (error as BadRequestException).getResponse() as {
          code: string;
        };
        expect(response.code).toBe('COMMENT_REQUIRED');
      }
    });

    it('accepts them when a comment is supplied', () => {
      expect(() =>
        assertTransition(
          UNDER_REVIEW,
          NEEDS_ADDITIONAL_INFO,
          'Please send the report',
        ),
      ).not.toThrow();
      expect(() =>
        assertTransition(UNDER_REVIEW, DENIED, 'Outside policy cover'),
      ).not.toThrow();
    });

    it('does not require a comment for the other legal moves', () => {
      expect(() => assertTransition(SUBMITTED, ASSIGNED)).not.toThrow();
      expect(() => assertTransition(ASSIGNED, UNDER_REVIEW)).not.toThrow();
      expect(() => assertTransition(UNDER_REVIEW, APPROVED)).not.toThrow();
      expect(() =>
        assertTransition(NEEDS_ADDITIONAL_INFO, UNDER_REVIEW),
      ).not.toThrow();
      expect(() =>
        assertTransition(NEEDS_ADDITIONAL_INFO, WITHDRAWN),
      ).not.toThrow();
    });

    it('checks legality before the comment requirement', () => {
      // APPROVED -> DENIED is illegal *and* missing a comment; the illegality wins.
      expect(() => assertTransition(APPROVED, DENIED)).toThrow(
        ConflictException,
      );
    });
  });
});

describe('actor rules (SPEC §3 "Actor" column)', () => {
  const OFFICER_MOVES: [RequestStatus, RequestStatus][] = [
    [SUBMITTED, ASSIGNED],
    [ASSIGNED, UNDER_REVIEW],
    [UNDER_REVIEW, NEEDS_ADDITIONAL_INFO],
    [UNDER_REVIEW, APPROVED],
    [UNDER_REVIEW, DENIED],
  ];

  const CUSTOMER_MOVES: [RequestStatus, RequestStatus][] = [
    [NEEDS_ADDITIONAL_INFO, UNDER_REVIEW],
    [NEEDS_ADDITIONAL_INFO, WITHDRAWN],
  ];

  it('assigns an actor to every legal transition and nothing else', () => {
    expect(Object.keys(TRANSITION_ACTOR).sort()).toEqual(
      LEGAL.map(([f, t]) => `${f}->${t}`).sort(),
    );
  });

  it.each(OFFICER_MOVES)('attributes %s -> %s to the officer', (from, to) => {
    expect(actorFor(from, to)).toBe(UserRole.OFFICER);
  });

  it.each(CUSTOMER_MOVES)('attributes %s -> %s to the customer', (from, to) => {
    expect(actorFor(from, to)).toBe(UserRole.CUSTOMER);
  });

  describe('assertOfficerTransition', () => {
    it.each(OFFICER_MOVES)('permits the officer move %s -> %s', (from, to) => {
      expect(() =>
        assertOfficerTransition(from, to, commentFor(to)),
      ).not.toThrow();
    });

    it.each(CUSTOMER_MOVES)(
      'refuses the customer-driven move %s -> %s with FORBIDDEN',
      (from, to) => {
        // SPEC §3: NEEDS_ADDITIONAL_INFO -> UNDER_REVIEW is "never set directly", and
        // withdrawing is the customer's alone. Both are legal moves, just not an
        // officer's to make through PATCH /status.
        expect(() => assertOfficerTransition(from, to, 'a reason')).toThrow(
          ForbiddenException,
        );
      },
    );

    it('still rejects an outright illegal move as INVALID_TRANSITION', () => {
      expect(() => assertOfficerTransition(APPROVED, UNDER_REVIEW)).toThrow(
        ConflictException,
      );
    });

    it('still enforces the comment requirement', () => {
      expect(() => assertOfficerTransition(UNDER_REVIEW, DENIED)).toThrow(
        BadRequestException,
      );
    });

    it('leaves WITHDRAWN unreachable for an officer from any status', () => {
      for (const from of REQUEST_STATUSES) {
        expect(() =>
          assertOfficerTransition(from, WITHDRAWN, 'a reason'),
        ).toThrow();
      }
    });
  });

  describe('assertCurrentStatus', () => {
    it('passes when the status matches', () => {
      expect(() =>
        assertCurrentStatus(
          NEEDS_ADDITIONAL_INFO,
          NEEDS_ADDITIONAL_INFO,
          'responded to',
        ),
      ).not.toThrow();
    });

    it('rejects a mismatch with INVALID_TRANSITION', () => {
      try {
        assertCurrentStatus(ASSIGNED, NEEDS_ADDITIONAL_INFO, 'responded to');
        fail('expected a throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        const response = (error as ConflictException).getResponse() as {
          code: string;
        };
        expect(response.code).toBe('INVALID_TRANSITION');
      }
    });

    it('blocks responding to an ASSIGNED request', () => {
      // ASSIGNED -> UNDER_REVIEW is legal, so assertTransition alone would let a customer
      // push an assigned request into review. This guard is what stops that.
      expect(canTransition(ASSIGNED, UNDER_REVIEW)).toBe(true);
      expect(() =>
        assertCurrentStatus(ASSIGNED, NEEDS_ADDITIONAL_INFO, 'responded to'),
      ).toThrow(ConflictException);
    });
  });
});

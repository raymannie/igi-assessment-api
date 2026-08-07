/** SPEC.md §3/§4 — must match the frontend union exactly. */
export enum RequestStatus {
  SUBMITTED = 'SUBMITTED',
  ASSIGNED = 'ASSIGNED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  NEEDS_ADDITIONAL_INFO = 'NEEDS_ADDITIONAL_INFO',
  APPROVED = 'APPROVED',
  DENIED = 'DENIED',
  WITHDRAWN = 'WITHDRAWN',
}

export const REQUEST_STATUSES = Object.values(RequestStatus);

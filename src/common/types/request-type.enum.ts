/** SPEC.md §4 — must match the frontend union exactly. */
export enum RequestType {
  INSURANCE_CLAIM = 'INSURANCE_CLAIM',
  HMO_PRE_AUTHORIZATION = 'HMO_PRE_AUTHORIZATION',
}

export const REQUEST_TYPES = Object.values(RequestType);

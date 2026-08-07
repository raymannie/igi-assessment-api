/** SPEC.md §4 — must match the frontend union exactly. */
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  OFFICER = 'OFFICER',
}

export const USER_ROLES = Object.values(UserRole);

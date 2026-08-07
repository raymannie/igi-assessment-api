/** SPEC.md §4 — must match the frontend union exactly. */
export enum ProductCategory {
  MOTOR = 'MOTOR',
  HEALTH = 'HEALTH',
  TRAVEL = 'TRAVEL',
  LIFE = 'LIFE',
  PROPERTY = 'PROPERTY',
  MARINE = 'MARINE',
}

export const PRODUCT_CATEGORIES = Object.values(ProductCategory);

import { CookieOptions } from 'express';

export const REFRESH_COOKIE_NAME = 'refreshToken';

/** Scoped to the auth routes so the cookie is not sent with every API call. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const BCRYPT_COST = 10;

/**
 * SPEC.md §8 wants sameSite=none + secure so the deployed frontend on another origin can
 * hold the cookie. Browsers reject sameSite=none without secure, and secure cookies do
 * not survive plain-http localhost — hence the development fallback to lax.
 */
export function refreshCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

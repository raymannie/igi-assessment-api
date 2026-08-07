import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Exempts a route from the globally-registered JwtAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

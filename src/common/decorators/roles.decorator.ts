import { SetMetadata } from '@nestjs/common';

import { UserRole } from '../types/user-role.enum';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles. Answers "is this an officer?" only —
 * per-record ownership is a separate concern (see CLAUDE.md pattern 3).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

import { UserRole } from '../../common/types/user-role.enum';
import { UserDocument } from '../../users/schemas/user.schema';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** Refresh tokens only — see AuthService.issueTokens for why it is needed. */
  jti?: string;
}

/** What the `jwt-refresh` strategy attaches to the request. */
export interface RefreshContext {
  user: UserDocument;
  refreshToken: string;
}

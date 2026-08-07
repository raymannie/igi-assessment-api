import { model } from 'mongoose';

import { UserRole } from '../../common/types/user-role.enum';
import { User, UserSchema } from './user.schema';

/** Compiling a model needs no live connection, so this exercises the real transform. */
const UserModel = model<User>('UserSchemaSpec', UserSchema);

describe('UserSchema toJSON', () => {
  const build = () =>
    new UserModel({
      email: 'Chidi.Nwosu@Example.COM',
      passwordHash: '$2b$10$notarealhash',
      refreshTokenHash: '$2b$10$alsonotarealhash',
      role: UserRole.CUSTOMER,
      fullName: 'Chidi Nwosu',
      policyNumber: 'IGI-POL-0001',
    });

  it('strips both hashes', () => {
    const json = build().toJSON();
    expect(json).not.toHaveProperty('passwordHash');
    expect(json).not.toHaveProperty('refreshTokenHash');
  });

  it('survives a JSON round-trip without leaking hashes', () => {
    // This is the path an HTTP response actually takes.
    expect(JSON.stringify(build())).not.toContain('notarealhash');
  });

  it('keeps the fields a client needs', () => {
    const json = build().toJSON() as Record<string, unknown>;
    expect(json.fullName).toBe('Chidi Nwosu');
    expect(json.role).toBe(UserRole.CUSTOMER);
    expect(json.policyNumber).toBe('IGI-POL-0001');
  });

  it('lowercases the email', () => {
    expect(build().email).toBe('chidi.nwosu@example.com');
  });

  it('defaults role to CUSTOMER', () => {
    const user = new UserModel({
      email: 'x@y.test',
      passwordHash: 'h',
      fullName: 'X Y',
    });
    expect(user.role).toBe(UserRole.CUSTOMER);
  });
});

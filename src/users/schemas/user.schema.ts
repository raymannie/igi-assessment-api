import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { USER_ROLES, UserRole } from '../../common/types/user-role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  // `unique` already builds the index SPEC §5 asks for; adding `index: true` as well
  // makes Mongoose warn about a duplicate index.
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  // `select: false` keeps the hashes out of every query by default; the toJSON transform
  // below is the second line of defence for the paths that do ask for them.
  @Prop({ required: true, select: false })
  passwordHash: string;

  // `type: String` is required: SchemaFactory cannot infer a Mongoose type from a TS
  // enum-typed property, and throws at schema-build time (i.e. at boot) without it.
  @Prop({
    type: String,
    required: true,
    enum: USER_ROLES,
    default: UserRole.CUSTOMER,
  })
  role: UserRole;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true })
  policyNumber?: string;

  @Prop({ select: false })
  refreshTokenHash?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

/**
 * CLAUDE.md pattern 6 — hashes can never leave the process via a serialised response,
 * regardless of what any individual call site remembered to select.
 *
 * Note this only fires for hydrated documents. Read paths that use `.lean()` bypass it,
 * so they must project the fields away themselves.
 */
UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    const plain = ret as unknown as Record<string, unknown>;
    delete plain.passwordHash;
    delete plain.refreshTokenHash;
    delete plain.__v;
    return plain;
  },
});

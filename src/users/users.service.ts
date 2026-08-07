import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { UserRole } from '../common/types/user-role.enum';
import { User, UserDocument } from './schemas/user.schema';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  phone?: string;
  policyNumber?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * `withPasswordHash` opts into the `select: false` field — login needs it, nothing
   * else should. Documents are returned hydrated (not lean) so the toJSON transform
   * still applies if one is ever serialised directly.
   */
  findByEmail(
    email: string,
    withPasswordHash = false,
  ): Promise<UserDocument | null> {
    const query = this.userModel.findOne({ email: email.toLowerCase().trim() });
    return (withPasswordHash ? query.select('+passwordHash') : query).exec();
  }

  findById(
    id: string,
    withRefreshTokenHash = false,
  ): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    const query = this.userModel.findById(id);
    return (
      withRefreshTokenHash ? query.select('+refreshTokenHash') : query
    ).exec();
  }

  create(input: CreateUserInput): Promise<UserDocument> {
    return this.userModel.create(input);
  }

  async setRefreshTokenHash(
    id: string,
    refreshTokenHash: string,
  ): Promise<void> {
    await this.userModel
      .updateOne({ _id: id }, { $set: { refreshTokenHash } })
      .exec();
  }

  async clearRefreshToken(id: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: id }, { $unset: { refreshTokenHash: 1 } })
      .exec();
  }
}

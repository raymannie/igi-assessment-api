import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { validationSchema } from './config/validation.schema';
import { HealthModule } from './health/health.module';
import { RequestsModule } from './requests/requests.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Earlier entries win, so a local override beats the committed-workflow .env.
      envFilePath: ['.env.local', '.env'],
      validationSchema,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    HealthModule,
    UsersModule,
    AuthModule,
    AuditModule,
    RequestsModule,
  ],
  providers: [
    // Order matters: rate limiting runs before authentication, so a flood of bad
    // credentials is throttled rather than hitting bcrypt every time.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Authentication is the default; routes opt out with @Public.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

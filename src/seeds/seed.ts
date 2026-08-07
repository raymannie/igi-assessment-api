import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';

import { AppModule } from '../app.module';
import { BCRYPT_COST } from '../auth/auth.constants';
import { RequestsService } from '../requests/requests.service';
import { HydratedRequest, Request } from '../requests/schemas/request.schema';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  SEED_REQUESTS,
  SEED_USERS,
  SeedFileSpec,
  SeedRequest,
  SeedStep,
} from './seed-data';

const logger = new Logger('Seed');

/** Smallest thing Cloudinary will accept as each type; the bytes are not the point. */
const MINIMAL_PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n'),
  'utf8',
);

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function asUploadedFile(spec: SeedFileSpec): Express.Multer.File {
  const buffer = spec.kind === 'pdf' ? MINIMAL_PDF : MINIMAL_PNG;
  return {
    originalname: spec.fileName,
    mimetype: spec.kind === 'pdf' ? 'application/pdf' : 'image/png',
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

const daysAgo = (days: number): Date => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(9, 0, 0, 0);
  return date;
};

interface SeedTotals {
  usersCreated: number;
  usersExisting: number;
  requestsCreated: number;
  requestsExisting: number;
  documentsSkipped: number;
}

async function upsertUsers(
  usersService: UsersService,
  totals: SeedTotals,
): Promise<Record<string, UserDocument>> {
  const byKey: Record<string, UserDocument> = {};

  for (const spec of SEED_USERS) {
    const existing = await usersService.findByEmail(spec.email);

    if (existing) {
      byKey[spec.key] = existing;
      totals.usersExisting += 1;
      logger.log(`user ${spec.email} already present`);
      continue;
    }

    // Officers cannot be created through /auth/register (SPEC §11.1), so the seed is the
    // only path that makes one — hence hashing here rather than going via AuthService.
    byKey[spec.key] = await usersService.create({
      email: spec.email,
      passwordHash: await bcrypt.hash(spec.password, BCRYPT_COST),
      fullName: spec.fullName,
      role: spec.role,
      phone: spec.phone,
      policyNumber: spec.policyNumber,
    });

    totals.usersCreated += 1;
    logger.log(`created ${spec.role.toLowerCase()} ${spec.email}`);
  }

  return byKey;
}

/**
 * Replays one request's history through the public service methods. Nothing here writes a
 * status or an audit entry directly — every transition goes through the same
 * assertTransition path an HTTP caller would hit, so an illegal seed fails loudly instead
 * of quietly producing data the API could never have created.
 */
async function replaySteps(
  requestsService: RequestsService,
  requestId: string,
  spec: SeedRequest,
  users: Record<string, UserDocument>,
  totals: SeedTotals,
): Promise<void> {
  const customer = users[spec.customer];
  let assignee: UserDocument | undefined;

  for (const step of spec.steps) {
    await applyStep(step);
  }

  async function applyStep(step: SeedStep): Promise<void> {
    switch (step.action) {
      case 'assign':
        assignee = users[step.officer];
        await requestsService.assign(requestId, assignee);
        return;

      case 'status':
        if (!assignee) {
          throw new Error(
            `${spec.description}: a status step needs an assigned officer`,
          );
        }
        await requestsService.updateStatus(requestId, assignee, {
          status: step.to,
          comment: step.comment,
        });
        return;

      case 'respond':
        await requestsService.respond(requestId, customer, {
          message: step.message,
        });
        return;

      case 'withdraw':
        await requestsService.withdraw(requestId, customer);
        return;

      case 'documents': {
        const uploader = step.by === 'customer' ? customer : assignee;
        if (!uploader) {
          throw new Error(`${spec.description}: no uploader available`);
        }
        try {
          await requestsService.addDocuments(
            requestId,
            uploader,
            step.files.map(asUploadedFile),
          );
        } catch (error) {
          // Cloudinary is the one dependency a seed can reasonably survive without: the
          // requests and their audit trails are the point. Loud, not silent.
          totals.documentsSkipped += step.files.length;
          logger.warn(
            `could not attach documents to "${spec.description.slice(0, 48)}…": ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
        return;
      }
    }
  }
}

async function seedRequests(
  requestsService: RequestsService,
  requestModel: Model<HydratedRequest>,
  users: Record<string, UserDocument>,
  totals: SeedTotals,
): Promise<void> {
  for (const spec of SEED_REQUESTS) {
    const customer = users[spec.customer];

    // `description` is the natural key. There is no seed marker on the schema (SPEC §5
    // fixes the fields), and requestNumber is allocated by the counter so it cannot
    // identify a row across runs.
    const existing = await requestModel
      .findOne({ customer: customer._id, description: spec.description })
      .select('status requestNumber')
      .lean()
      .exec();

    if (existing) {
      totals.requestsExisting += 1;
      if (existing.status !== spec.expectedStatus) {
        logger.warn(
          `${existing.requestNumber} is ${existing.status}, expected ${spec.expectedStatus} — ` +
            'left untouched; delete it and re-run to rebuild its history',
        );
      }
      continue;
    }

    const created = (await requestsService.create(customer, {
      requestType: spec.requestType,
      productCategory: spec.productCategory,
      policyNumber: spec.policyNumber,
      description: spec.description,
      incidentDate: daysAgo(spec.incidentDaysAgo),
      serviceProvider: spec.serviceProvider,
      estimatedAmount: spec.estimatedAmount,
    })) as { _id: unknown; requestNumber: string };

    const requestId = String(created._id);
    await replaySteps(requestsService, requestId, spec, users, totals);

    const final = await requestModel
      .findById(requestId)
      .select('status')
      .lean()
      .exec();
    if (final?.status !== spec.expectedStatus) {
      throw new Error(
        `${created.requestNumber} ended as ${String(final?.status)} but the seed expected ` +
          `${spec.expectedStatus} — the state machine and the seed data disagree`,
      );
    }

    totals.requestsCreated += 1;
    logger.log(`created ${created.requestNumber} (${spec.expectedStatus})`);
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const totals: SeedTotals = {
    usersCreated: 0,
    usersExisting: 0,
    requestsCreated: 0,
    requestsExisting: 0,
    documentsSkipped: 0,
  };

  try {
    const usersService = app.get(UsersService);
    const requestsService = app.get(RequestsService);
    const requestModel = app.get<Model<HydratedRequest>>(
      getModelToken(Request.name),
    );

    const users = await upsertUsers(usersService, totals);
    await seedRequests(requestsService, requestModel, users, totals);

    logger.log(
      `done — users: ${totals.usersCreated} created, ${totals.usersExisting} already there; ` +
        `requests: ${totals.requestsCreated} created, ${totals.requestsExisting} already there`,
    );

    if (totals.documentsSkipped) {
      logger.warn(
        `${totals.documentsSkipped} document(s) could not be uploaded — check the ` +
          'CLOUDINARY_* credentials, then delete the affected requests and re-run',
      );
    }
  } finally {
    await app.close();
  }
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    'seed failed',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});

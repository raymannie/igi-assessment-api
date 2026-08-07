# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Backend for the IGI Claims & Pre-Authorization Management Portal — a NestJS + MongoDB API
that digitises insurance claim and HMO pre-authorization requests.

**Read [SPEC.md](SPEC.md) first.** It is the shared contract between this repo and the
frontend repo (an identical copy lives in both) and holds the domain vocabulary, state
machine, enums, data model, API surface, and security requirements. If SPEC.md changes
here, it must change in the frontend repo too. This file covers only *how we build it here*.

**Current state: the application shell is in place; no feature modules yet.** Done:
config validation (`config/validation.schema.ts`), `AppModule` wiring (Config, Mongoose,
Throttler), the global `TransformInterceptor` and `AllExceptionsFilter`, `GET /health`,
and `main.ts` (prefix, helmet, cookie-parser, CORS, ValidationPipe), plus Swagger at
`/api/docs`. `users` and `auth` are complete: the User schema, register/login/refresh/
logout/me, both JWT strategies, and the `@Public`/`@Roles`/`@CurrentUser` +
`JwtAuthGuard`/`RolesGuard` layer. `JwtAuthGuard` is registered globally, so **every new
route is authenticated by default** — opt out with `@Public()`.

`requests`, `audit` and `uploads` are complete: schemas with every SPEC §5 index, the
state machine, the atomic `counters` requestNumber generator, `RequestOwnershipGuard`,
`ParseObjectIdPipe`, `FileValidationPipe`, Cloudinary behind `UploadsService`, and every
SPEC §6 request endpoint — create, list, read, audit-logs, assign, status, respond
(with optional attachments), withdraw, documents.

`seeds` is done — `npm run seed` boots an application context and replays each request's
history through the real service methods, so every transition is state-machine-validated
and every audit entry is genuine. Idempotent: users key on email, requests on
`description`.

Not started: `dashboard`. Its dependencies are already installed.

`CLAUDE-backend.md` is the original draft of this file and is now superseded — prefer this
one; delete that one when convenient.

## Commands

```bash
npm run start:dev              # watch mode
npm run build                  # nest build → dist/
npm run start:prod             # node dist/main
npm test                       # jest, rootDir=src, matches *.spec.ts
npm test -- request-state      # single suite by path/name substring
npm test -- -t "illegal transition"   # single test by name
npm run test:e2e               # jest --config ./test/jest-e2e.json, matches *.e2e-spec.ts
npm run test:cov
npm run lint                   # eslint --fix
npm run format                 # prettier --write
```

`npm run seed` (`ts-node src/seeds/seed.ts`) is idempotent and safe to re-run against
production. Seed *content* lives in `src/seeds/seed-data.ts`; `seed-data.spec.ts` replays
every row against the state machine, so an illegal sequence fails in CI rather than
part-way through writing to the database.

## Stack notes that differ from the drafts

- **NestJS 11** and **Mongoose 9** (not 10/8 as the older draft says).
- TypeScript is **not** in full strict mode: `strictNullChecks` is on, but `noImplicitAny`
  and `strictBindCallApply` are off. Don't assume strict-mode diagnostics will catch things.
- `module`/`moduleResolution` are `nodenext`, so relative imports resolve as ESM-ish under
  a CommonJS `sourceType` in eslint. Follow the existing extensionless import style.
- ESLint runs `recommendedTypeChecked` + prettier-as-an-error. Formatting violations fail lint.

## Environment

Copy `.env.example`. All of these are required; validate them at boot with a Joi schema in
`ConfigModule.forRoot({ validationSchema })` so a missing var fails loudly at startup
rather than at the first request.

```
PORT NODE_ENV MONGODB_URI
JWT_ACCESS_SECRET JWT_REFRESH_SECRET JWT_ACCESS_TTL JWT_REFRESH_TTL
CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET
FRONTEND_URL
```

## Target structure

```
src/
  main.ts                    # helmet, cors, global pipe/filter/interceptor, /api/v1 prefix
  config/                    configuration.ts, validation.schema.ts
  common/
    decorators/              @Roles, @CurrentUser, @Public
    guards/                  JwtAuthGuard, RolesGuard, RequestOwnershipGuard
    filters/                 AllExceptionsFilter  -> { success:false, error:{...} }
    interceptors/            TransformInterceptor -> { success:true, data, meta }
    pipes/                   ParseObjectIdPipe, FileValidationPipe
    dto/ types/
  auth/                      + strategies/ (jwt, jwt-refresh), dto/
  users/                     schemas/user.schema.ts, users.service.ts
  requests/                  request-state.machine.ts, schemas/, dto/
  audit/                     audit.service.ts, schemas/audit-log.schema.ts
  uploads/                   cloudinary.provider.ts, uploads.service.ts
  dashboard/
  seeds/seed.ts
```

## Non-negotiable patterns

**1. The state machine lives in exactly one file.** `requests/request-state.machine.ts`
exports `TRANSITIONS`, `COMMENT_REQUIRED`, and `assertTransition(from, to, comment?)`
which throws `ConflictException` / `BadRequestException`. No status comparison logic
anywhere else in the codebase. The table itself is in [SPEC.md](SPEC.md) §3.

**2. Audit logging happens inside the service that mutates.** Never from a controller,
never from an interceptor. Every method in `RequestsService` that changes state calls
`this.auditService.log({...})` in the same flow. A mutation without an audit call is an
incomplete feature. `auditlogs` is append-only — no update or delete routes, ever.

**3. Ownership is checked separately from role.** `RolesGuard` answers "is this an
officer?"; `RequestOwnershipGuard` answers "may *this* user touch *this* request?". Both
run on request-scoped routes. A customer with a valid token must get 403 on another
customer's request — there should be a test for exactly that.

**4. DTOs on every endpoint.** Global
`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
`serviceProvider` uses `@ValidateIf(o => o.requestType === 'HMO_PRE_AUTHORIZATION')`.

**5. Controllers are thin.** Route + guards + DTO + one service call. Logic lives in services.

**6. Never leak hashes.** Put a `toJSON` transform on the user schema that deletes
`passwordHash` and `refreshTokenHash`, rather than relying on `.select('-passwordHash')`
at each call site.

**7. Consistent errors.** Throw Nest HTTP exceptions carrying a `code`; the global filter
shapes them into the envelope in [SPEC.md](SPEC.md) §6. Mongo duplicate-key (11000) maps
to 409 with a readable message, not a 500.

## Implementation gotchas

**`requestNumber`** — `CLM-{year}-{6-digit seq}` / `PRE-{year}-{6-digit seq}`. Generate
from a small `counters` collection via
`findOneAndUpdate({ $inc: { seq: 1 } }, { upsert: true, new: true })`. Atomic, no race.
Never `countDocuments()`.

**Querying** — build the officer list filter as a single `$match` object, then
`Promise.all([find, countDocuments])`. `.lean()` on all read paths. Populate `customer`
and `assignedOfficer` with `fullName email` only. Cap `limit` at 50 server-side regardless
of what the client asks for.

**Cloudinary** — Multer `memoryStorage()`, then `cloudinary.uploader.upload_stream(buffer)`
wrapped in a Promise. `resource_type: 'auto'` (PDFs land under `/raw/` or `/image/`
depending on it — upload one and open the URL before moving on). Validate MIME **and**
extension **and** size in `FileValidationPipe` before hitting Cloudinary. Store `publicId`
and add a `destroy` path even if unused. Keep the SDK behind `UploadsService` so it's
swappable.

## Testing priorities

1. `request-state.machine.spec.ts` — every legal transition, several illegal ones, both
   comment-required cases.
2. One e2e walking register → login → create → assign → review → needs-info → respond →
   approve, asserting the audit trail's length *and* order.

## Deployment

Railway or Render. `npm run build && node dist/main`. Health check at `GET /api/v1/health`.
CORS origin from `FRONTEND_URL` with `credentials: true`. Run the seed against prod once
after the first deploy (it must be idempotent — safe to re-run).

Note: `README.md` is still the stock NestJS starter README. Per [SPEC.md](SPEC.md) §10 it
needs replacing with setup, stack rationale, assumptions, and the seeded test credentials.

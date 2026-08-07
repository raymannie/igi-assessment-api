# CLAUDE.md — Backend (NestJS)

> Rename this file to `CLAUDE.md` in the backend repo root.
> Read `SPEC.md` first — it holds the domain contract, state machine, data model, and
> API surface. This file covers *how we build it here*.

---

## Stack

NestJS 10 · TypeScript (strict) · Mongoose 8 · MongoDB Atlas · Passport JWT · bcrypt ·
class-validator / class-transformer · Cloudinary SDK · Multer (memory storage) · Jest

## Commands

```bash
npm run start:dev      # watch mode
npm run build
npm run seed           # idempotent seed, reads MONGODB_URI
npm test
npm run lint
```

## Environment

```
PORT=4000
NODE_ENV=development
MONGODB_URI=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
FRONTEND_URL=http://localhost:3000
```

Validate these at boot with a Joi schema in `ConfigModule.forRoot({ validationSchema })`.
Fail loudly on missing config rather than crashing at first request.

---

## Structure

```
src/
  main.ts                    # helmet, cors, global pipe/filter/interceptor, /api/v1 prefix
  app.module.ts
  config/
    configuration.ts
    validation.schema.ts
  common/
    decorators/              @Roles, @CurrentUser, @Public
    guards/                  JwtAuthGuard, RolesGuard, RequestOwnershipGuard
    filters/                 AllExceptionsFilter  -> { success:false, error:{...} }
    interceptors/            TransformInterceptor -> { success:true, data, meta }
    pipes/                   ParseObjectIdPipe, FileValidationPipe
    dto/                     PaginationQueryDto
    types/                   shared enums + RequestStatus union
  auth/
    auth.module|controller|service.ts
    strategies/              jwt.strategy.ts, jwt-refresh.strategy.ts
    dto/                     RegisterDto, LoginDto
  users/
    schemas/user.schema.ts
    users.service.ts
  requests/
    requests.module|controller|service.ts
    request-state.machine.ts       # TRANSITIONS + assertTransition()
    schemas/request.schema.ts
    dto/                           CreateRequestDto, QueryRequestsDto, UpdateStatusDto,
                                   RespondDto
  audit/
    audit.module|service.ts
    schemas/audit-log.schema.ts
  uploads/
    cloudinary.provider.ts
    uploads.service.ts
  dashboard/
    dashboard.module|controller|service.ts
  seeds/
    seed.ts
```

---

## Non-negotiable patterns

**1. The state machine lives in exactly one file.**
`request-state.machine.ts` exports `TRANSITIONS`, `COMMENT_REQUIRED`, and
`assertTransition(from, to, comment?)` which throws `ConflictException` /
`BadRequestException`. No status comparison logic anywhere else in the codebase.

**2. Audit logging happens inside the service that mutates.**
Never from a controller, never from an interceptor. Every method in `RequestsService`
that changes state calls `this.auditService.log({...})` in the same flow. If you add a
mutation and forget the audit call, the feature is incomplete.

**3. Ownership is checked separately from role.**
`RolesGuard` answers "is this an officer?". `RequestOwnershipGuard` answers "may *this*
user touch *this* request?". Both run on request-scoped routes. A customer holding a
valid token must get 403 on someone else's request — write a test for this.

**4. DTOs on every endpoint.**
Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
Conditional validation for `serviceProvider` uses `@ValidateIf(o => o.requestType === 'HMO_PRE_AUTHORIZATION')`.

**5. Controllers are thin.**
Route + guards + DTO + one service call. All logic in services.

**6. Never leak hashes.**
`toJSON` transform on the user schema deletes `passwordHash` and `refreshTokenHash`.
Don't rely on remembering `.select('-passwordHash')` at each call site.

**7. Consistent errors.**
Throw Nest HTTP exceptions with a `code` in the payload; the global filter shapes them
into the envelope from `SPEC.md` §6. Mongo duplicate-key (11000) maps to 409 with a
readable message, not a 500.

---

## Cloudinary notes

- Multer `memoryStorage()`, then `cloudinary.uploader.upload_stream(buffer)` wrapped in a Promise.
- `resource_type: 'auto'` — PDFs land under `/raw/` or `/image/` depending on this; upload one and open the URL before moving on.
- Validate MIME + extension + size in `FileValidationPipe` before hitting Cloudinary.
- Store `publicId`; add a `destroy` path even if unused.
- Wrap the SDK behind `UploadsService` so it's swappable. Say so in the README.

## `requestNumber` generation

`CLM-{year}-{6-digit sequence}` / `PRE-{year}-{6-digit sequence}`. Use a small `counters`
collection with `findOneAndUpdate({ $inc: { seq: 1 } }, { upsert: true, new: true })` —
atomic, no race. Don't use `countDocuments()`.

## Querying

Build the officer list filter as a single `$match` object, then `Promise.all([find, countDocuments])`.
`.lean()` on all read paths. Populate `customer` and `assignedOfficer` with
`fullName email` only. Cap `limit` at 50 server-side regardless of what's requested.

## Testing (bonus, but cheap points)

Priority: `request-state.machine.spec.ts` covering every legal transition, a few illegal
ones, and both comment-required cases. Then one e2e: register → login → create → assign →
review → needs-info → respond → approve, asserting the audit trail length and order.

## Deployment

Railway or Render. `npm run build && node dist/main`. Health check at `GET /api/v1/health`.
CORS origin from `FRONTEND_URL` with `credentials: true`. Run `npm run seed` against prod
once after the first deploy.

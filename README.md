# IGI Claims & Pre-Authorization Portal — API

Backend for a portal that digitises insurance claim and HMO pre-authorization requests.
Customers submit requests and track them; claims officers triage, review and decide them.
Every state change is recorded in an append-only audit trail.

NestJS 11 · MongoDB (Mongoose 9) · JWT auth · Cloudinary · Swagger

> **[SPEC.md](SPEC.md) is the contract** between this repo and the frontend. It holds the
> domain vocabulary, state machine, enums, data model and API surface. An identical copy
> lives in the frontend repo — if it changes here, it changes there too. This file covers
> how to run the thing and why it is built the way it is.

---

## Quick start

**Prerequisites** — Node 20 or newer (developed on 22; no `engines` field is declared),
a MongoDB instance (local or Atlas), and a Cloudinary account for file uploads.

```bash
npm install
cp .env.example .env        # then fill it in — see below
npm run start:dev           # http://localhost:4000
```

- API: `http://localhost:4000/api/v1`
- Swagger UI: `http://localhost:4000/api/docs` — **not** under `/api/v1`, because
  `setGlobalPrefix` only applies to controllers
- Health check: `http://localhost:4000/api/v1/health`

### Environment

Every variable is validated by a Joi schema at boot ([`src/config/validation.schema.ts`](src/config/validation.schema.ts)),
so a missing or malformed value fails loudly on startup rather than at the first request
that needs it.

| Variable | Required | Notes |
| --- | --- | --- |
| `MONGODB_URI` | yes | `mongodb://` or `mongodb+srv://` |
| `JWT_ACCESS_SECRET` | yes | **min 32 chars** — `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | yes | min 32 chars. Use a *different* value from the access secret — the two token types are meant to be separately forgeable, but nothing enforces this at boot |
| `CLOUDINARY_CLOUD_NAME` | yes | |
| `CLOUDINARY_API_KEY` | yes | |
| `CLOUDINARY_API_SECRET` | yes | |
| `NODE_ENV` | no | defaults to `development` |
| `PORT` | no | defaults to `4000` |
| `JWT_ACCESS_TTL` | no | defaults to `15m` |
| `JWT_REFRESH_TTL` | no | defaults to `7d` |
| `FRONTEND_URL` | no | defaults to `http://localhost:3000`; drives the CORS origin |

### Seeding

```bash
npm run seed
```

Idempotent and safe to re-run, including against production. Users are keyed on email and
requests on their `description`, so a second run creates nothing.

It boots a real Nest application context and replays each request's history through the
same service methods the HTTP layer calls — so every transition is validated by the state
machine and every audit entry is genuine, not hand-inserted. It creates 4 users and 12
requests spanning all seven statuses, both request types and six product categories, with
audit trails from 1 to 6 entries.

### Test credentials

| Role | Email | Password |
| --- | --- | --- |
| Officer | `officer@igi.test` | `Officer123` |
| Officer | `officer2@igi.test` | `Officer123` |
| Customer | `customer@igi.test` | `Customer123` |
| Customer | `customer2@igi.test` | `Customer123` |

Officer accounts can only be created by the seed. `POST /auth/register` always produces a
`CUSTOMER`, whatever the request body says.

---

## API surface

All routes are prefixed `/api/v1` and require a bearer access token unless marked public.

| Method | Route | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | public | Liveness + DB connection state |
| `POST` | `/auth/register` | public | Register a customer; signs them in |
| `POST` | `/auth/login` | public | Access token in the body, refresh token in a cookie |
| `POST` | `/auth/refresh` | cookie | Rotate the refresh token |
| `POST` | `/auth/logout` | any | Clear the stored refresh hash and the cookie |
| `GET` | `/auth/me` | any | The current user |
| `POST` | `/requests` | customer | Submit a request (starts in `SUBMITTED`) |
| `GET` | `/requests` | any | Customers see their own; officers see all, filtered + paginated |
| `GET` | `/requests/:id` | owner / officer | One request |
| `GET` | `/requests/:id/audit-logs` | owner / officer | Its audit trail, oldest first |
| `POST` | `/requests/:id/assign` | officer | Claim it; `SUBMITTED → ASSIGNED` |
| `PATCH` | `/requests/:id/status` | assignee | Officer-driven transitions |
| `POST` | `/requests/:id/respond` | owner | Answer an information request; back to `UNDER_REVIEW` |
| `POST` | `/requests/:id/withdraw` | owner | Withdraw; terminal |
| `POST` | `/requests/:id/documents` | owner / assignee | Attach up to 5 files |
| `GET` | `/dashboard/stats` | officer | Queue metrics |

Responses share one envelope, applied globally by an interceptor and an exception filter:

```jsonc
{ "success": true,  "data": { }, "meta": { } }          // meta only on paginated lists
{ "success": false, "error": { "code": "…", "message": "…", "details": [] } }
```

---

## Architecture decisions

### The state machine lives in exactly one file

[`requests/request-state.machine.ts`](src/requests/request-state.machine.ts) owns
`TRANSITIONS`, `COMMENT_REQUIRED` and `assertTransition`. No status comparison happens
anywhere else. When a new question about statuses came up — "is this terminal?", "may an
officer make this move?" — the answer was a new helper in that file, not an `if` somewhere
else. It has a spec that asserts the full 49-cell cross-product, so widening the table
accidentally is a test failure rather than a surprise in production.

**SPEC §3's table has an "Actor" column, and the table alone is not enough to enforce it.**
`NEEDS_ADDITIONAL_INFO → UNDER_REVIEW` is legal, but it is the customer's move via
`/respond` — "never set directly". Without encoding that, an officer could drive it through
`PATCH /status`, and could withdraw a customer's request on their behalf. Hence
`TRANSITION_ACTOR` and `assertOfficerTransition`, which refuse the two customer-driven
moves with a 403.

Similarly, `/respond` needs more than `assertTransition`: `ASSIGNED → UNDER_REVIEW` is
*also* legal, so the transition check alone would let a customer push an `ASSIGNED` request
into review and skip the officer's step. `assertCurrentStatus` pins `/respond` and
`/withdraw` to `NEEDS_ADDITIONAL_INFO`.

### Audit logging happens inside the service that mutates

Never from a controller, never from an interceptor. Every method that changes state calls
`auditService.log()` in the same flow, after the write succeeds — so a failed transition
leaves no entry. `auditlogs` is append-only: `AuditService` exposes exactly one write
method and no update or delete, `updatedAt` is disabled on the schema, and no route
touches it.

Actor role and name are **denormalised onto each entry**. If someone's name or role
changes later, the history still says who did what at the time.

### Ownership is checked separately from role

`RolesGuard` answers "is this an officer?"; `RequestOwnershipGuard` answers "may *this*
user touch *this* request?". A customer with a valid token gets **403 on another
customer's request, not 404** (SPEC §6 is explicit — it leaks that the id exists, which is
the trade-off the spec asks for). The assignee check is stricter still and lives in the
service, because `RequestOwnershipGuard` lets any officer through by design.

### Writes are conditional, not read-then-write

Every transition writes through a `findOneAndUpdate` filtered on the status it validated
against. Without that, two officers could both pass `assertTransition` from
`UNDER_REVIEW`, and land APPROVED-then-DENIED with an audit trail asserting both were
legal. `assign` additionally filters on `assignedOfficer: null`, so two officers claiming
at once cannot both win. A lost race is a 409.

`requestNumber` comes from an atomic `$inc` on a small `counters` collection, keyed
per type and year — never `countDocuments()`, which races and reuses numbers after a delete.

### Auth

Access tokens are short-lived and sent in the body; the refresh token is an httpOnly
cookie scoped to `/api/v1/auth`, and is rotated on every use.

Two details that are easy to get wrong and are covered by tests:

- **The refresh token is SHA-256'd before bcrypt.** bcrypt silently truncates at 72 bytes,
  and two refresh JWTs for the same user share a longer prefix than that — so hashing the
  raw token would make rotated-out tokens keep validating.
- **Each refresh token carries a random `jti`.** `iat` only has one-second resolution, so
  without it two refreshes in the same second mint a byte-identical token and rotation
  invalidates nothing.

Password and refresh hashes are `select: false` *and* stripped by a `toJSON` transform —
two independent layers, rather than relying on remembering `.select('-passwordHash')` at
each call site.

### Uploads are all-or-nothing

Files are held in memory (`memoryStorage`) and streamed straight to Cloudinary; nothing
touches disk. All files upload first, then land in the document in a single `$push`. If
any upload fails, the ones that succeeded are deleted before the error propagates — so
there is never a half-written `documents` array, nor orphaned files nothing references.
On `/respond`, uploads run *before* the transition, so a storage failure leaves the request
awaiting information rather than under review with its evidence missing.

`FileValidationPipe` checks MIME type **and** extension against each other — the
`Content-Type` header is the client's word, and renaming a file is trivial. The Cloudinary
SDK stays behind `UploadsService`, so swapping storage providers is a one-file change.

### Dashboard stats are one aggregation

`GET /dashboard/stats` uses a single `$facet` with six branches over one pass of the
collection. Beyond saving round trips, it means the metrics cannot contradict each other —
six separate queries could observe a request in `UNDER_REVIEW` for one count and `APPROVED`
for the next.

### Other conventions

- **Controllers are thin**: route, guards, DTO, one service call. Logic lives in services.
- **DTOs on every endpoint**, with a global
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
  Services still construct documents field by field rather than spreading a DTO, so a
  caller that bypasses the pipe cannot inject `status` or `assignedOfficer`.
- **`sortBy` is whitelisted** to six fields so it can never reach Mongo as arbitrary input.
- **Rate limiting**: 100 requests/minute globally, 10/minute on login and register.
- `helmet`, CORS restricted to `FRONTEND_URL` with credentials, and `JwtAuthGuard`
  registered globally so **every new route is authenticated by default** — opting out
  takes an explicit `@Public()`.

---

## Assumptions

SPEC.md leaves some things open. These are the calls made here, and they are the first
things to challenge in review.

**Interpretation of the spec**

1. **`approvalRate` is approved ÷ *decided*** (approved + denied), not ÷ total. Dividing by
   total would make the rate fall every time a new request is submitted, reading as the
   team getting worse when nothing about their decisions changed. Withdrawn requests are
   not decisions. It is a 0–1 fraction rounded to 4dp — not a percentage.
2. **`pendingAssignment` means `assignedOfficer: null`.** Given the state machine that is
   exactly the `SUBMITTED` count, so it duplicates `byStatus.SUBMITTED` by construction.
3. **`PATCH /status` refuses the two customer-driven transitions** with 403 rather than
   409 — the move is legal, just not the caller's to make.
4. **No reassignment** (SPEC §11.2): `assign` only ever matches while `assignedOfficer` is
   null. There is no route to move a request between officers.
5. **`limit` clamps to 50 rather than rejecting.** `?limit=500` returns 50 instead of a 400.

**Additions the spec does not describe**

6. **`POST /auth/register` signs the user in**, returning the same payload as login. Purely
   additive — a client that ignores `accessToken` still works.
7. **Duplicate email returns 409 with code `DUPLICATE_KEY`**, which is not in SPEC §6's code
   list. §6 only assigns `INVALID_TRANSITION` to 409, which is wrong for a registration
   conflict. **This diverges from the spec and should be synced to the frontend copy.**
8. **Attachments sent with `/respond`** are recorded as `metadata.fileNames` on the
   `CUSTOMER_RESPONDED` entry rather than a second `DOCUMENT_UPLOADED` entry — one audit
   entry per user action.
9. **`assign`, `withdraw` and `documents` return 200, not 201.** They amend an existing
   request rather than creating a resource.
10. **`logout` returns `{ message: 'Signed out' }`**, since `{ success: true }` would nest
    as `{ success: true, data: { success: true } }`.

**Consequences of the data model**

11. **Uploads are blocked once a request is terminal** (`APPROVED`, `DENIED`, `WITHDRAWN`).
12. **`deleteFile` has to guess the Cloudinary resource type.** `resource_type: 'auto'`
    puts PDFs under `/raw/` and images under `/image/`, and `destroy` needs that same type.
    SPEC §5's embedded document has no field to record it, so deletion tries `image`, then
    `raw`, then `video`. Adding a `resourceType` field would be cleaner if diverging from
    §5 is acceptable.
13. **The seed's idempotency key is `description`.** SPEC §5 fixes the schema so there is
    no seed marker to add, and `requestNumber` comes from the counter so it cannot identify
    a row across runs. Seed descriptions must stay unique — a test enforces it.
14. **The ownership guard returns 404 on a malformed id**, not 400. Guards run before
    pipes, so it answers first on `/requests/:id`; `ParseObjectIdPipe` still gives 400 on
    routes without the guard.

---

## Testing

```bash
npm test                      # unit — 285 tests
npm run test:e2e              # end-to-end — 26 tests
npm run test:cov              # coverage
npm test -- request-state     # one suite by path or name
npm test -- -t "illegal transition"
```

The heaviest coverage is where the risk is: the state machine (every legal transition,
all 42 illegal ones, both comment-required cases, and the actor rules), the ownership
403-not-404 rule, refresh-token rotation, the all-or-nothing upload guarantee, and the
seed data — which is replayed against the state machine in CI, so an illegal sequence
fails there rather than part-way through writing to a database.

**The auth e2e suite runs against an in-memory fake of `UsersService`, not a real
MongoDB.** It exercises the genuine controller, service, strategies and guards, and the
real schema's `toJSON` transform is covered separately by a unit test that compiles the
model without a connection. But no test in this repo talks to a live database — that is
the main gap in the suite.

---

## Deployment

Railway or Render.

```bash
npm run build && node dist/main
```

- Health check path: `GET /api/v1/health`
- Set every variable from the table above; `FRONTEND_URL` drives the CORS origin
- Run `npm run seed` once after the first deploy (it is idempotent, so a repeat is safe)

---

## Known gaps

Honest list of what is not finished or not verified.

- **Two seeded requests have no documents.** All four seed uploads fail against the current
  Cloudinary credentials — `CLOUDINARY_CLOUD_NAME` is rejected as invalid. Fix the value,
  delete those two requests, and re-run the seed. Document failures are deliberately
  non-fatal and reported at the end of the run, so a bad key costs attachments rather than
  the whole seed.
- **No test touches a real database.** See Testing above.
- **File contents are never inspected.** MIME type and extension are checked against each
  other, but a correctly-named, correctly-typed file with hostile bytes still passes.
  Content sniffing was out of scope for a prototype.
- **`@nestjs/swagger@11.4.6` pulls a `js-yaml` with two high-severity advisories**
  (`GHSA-pm4m-ph32-ghv5`). Downgrading to 11.4.5 clears them; not done here without a
  decision on the version.
- **Seeded requests all share a `createdAt` of "now".** `incidentDate` is spread across the
  last 30 days, but backdating `createdAt` would mean writing behind the services' backs,
  which would defeat the point of replaying the history through them.
- **No refresh-token reuse detection.** Rotation invalidates the old token, but presenting
  an already-rotated token is treated as an ordinary 401 rather than as evidence of theft
  that should revoke the whole session.

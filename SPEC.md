# SPEC.md — Claims & Pre-Authorization Management Portal

> **This file is the shared contract between the frontend and backend repos.**
> An identical copy lives in both. If you change it in one, change it in the other.
> Repo-specific conventions live in each repo's `CLAUDE.md`.

---

## 1. Context

IGI (insurance) and IHMS (HMO) currently take claims and pre-authorization requests by
email and paper. This is a working prototype of a portal that digitises that process.

Two roles, one core resource:

- **Customer / Enrollee** — submits requests, tracks them, responds to information requests, withdraws.
- **Officer** — reviews the queue, assigns to self, moves requests through the workflow, approves or denies.

Every meaningful action produces an immutable audit entry. The audit trail is the
centrepiece of the assessment, not an afterthought.

---

## 2. Domain vocabulary

| Term | Meaning |
|---|---|
| **Request** | A single Insurance Claim *or* HMO Pre-Authorization. One collection, discriminated by `requestType`. |
| **Enrollee** | HMO member. Same `User` record as a policyholder; the distinction is only `requestType` on the request. |
| **Officer** | Internal staff. Seeded, never self-registered. |
| **Assignee** | The one officer who owns a request. Only the assignee may change its status. |
| **Audit entry** | Immutable record of one action: who, what, from→to, comment, when. |

---

## 3. State machine

This is the heart of the app. Implement it as a **declarative transition table**, not
scattered conditionals. Both repos reference the same statuses.

```
                    ┌──────────────────────────────────┐
                    │                                  │
SUBMITTED → ASSIGNED → UNDER_REVIEW → NEEDS_ADDITIONAL_INFO
                            │  ▲                │
                            │  └────────────────┘  (customer responds → auto)
                            │                  │
                    ┌───────┴───────┐          └──→ WITHDRAWN
                    ▼               ▼
                APPROVED         DENIED
```

### Statuses

```ts
type RequestStatus =
  | 'SUBMITTED'
  | 'ASSIGNED'
  | 'UNDER_REVIEW'
  | 'NEEDS_ADDITIONAL_INFO'
  | 'APPROVED'
  | 'DENIED'
  | 'WITHDRAWN';
```

`APPROVED`, `DENIED`, `WITHDRAWN` are **terminal**. No transitions out of them.

### Transition table

| From | To | Actor | Guards |
|---|---|---|---|
| `SUBMITTED` | `ASSIGNED` | Officer | `assignedOfficer` must be null; sets it to the acting officer |
| `ASSIGNED` | `UNDER_REVIEW` | Officer | must be the assignee |
| `UNDER_REVIEW` | `NEEDS_ADDITIONAL_INFO` | Officer | must be the assignee; **`comment` required** |
| `NEEDS_ADDITIONAL_INFO` | `UNDER_REVIEW` | Customer | must be the owner; triggered by `POST /requests/:id/respond`, never set directly |
| `NEEDS_ADDITIONAL_INFO` | `WITHDRAWN` | Customer | must be the owner |
| `UNDER_REVIEW` | `APPROVED` | Officer | must be the assignee |
| `UNDER_REVIEW` | `DENIED` | Officer | must be the assignee; **`comment` (reason) required** |

Anything not in this table is rejected with `409 Conflict`.

### Reference implementation shape

```ts
export const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  SUBMITTED:              ['ASSIGNED'],
  ASSIGNED:               ['UNDER_REVIEW'],
  UNDER_REVIEW:           ['NEEDS_ADDITIONAL_INFO', 'APPROVED', 'DENIED'],
  NEEDS_ADDITIONAL_INFO:  ['UNDER_REVIEW', 'WITHDRAWN'],
  APPROVED:               [],
  DENIED:                 [],
  WITHDRAWN:              [],
};

export const COMMENT_REQUIRED: RequestStatus[] = ['NEEDS_ADDITIONAL_INFO', 'DENIED'];
```

---

## 4. Enums (shared, must match exactly on both sides)

```ts
type UserRole       = 'CUSTOMER' | 'OFFICER';
type RequestType    = 'INSURANCE_CLAIM' | 'HMO_PRE_AUTHORIZATION';
type ProductCategory = 'MOTOR' | 'HEALTH' | 'TRAVEL' | 'LIFE' | 'PROPERTY' | 'MARINE';
type AuditAction =
  | 'REQUEST_CREATED'
  | 'REQUEST_ASSIGNED'
  | 'STATUS_CHANGED'
  | 'DOCUMENT_UPLOADED'
  | 'CUSTOMER_RESPONDED'
  | 'REQUEST_WITHDRAWN';
```

**Rule:** `serviceProvider` is required when `requestType === 'HMO_PRE_AUTHORIZATION'`,
optional otherwise. Enforce on both sides.

---

## 5. Data model (MongoDB)

### `users`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `email` | string | unique, lowercased, indexed |
| `passwordHash` | string | bcrypt, cost 10; never serialised |
| `role` | UserRole | |
| `fullName` | string | |
| `phone` | string? | |
| `policyNumber` | string? | customers only |
| `refreshTokenHash` | string? | never serialised |
| `createdAt` / `updatedAt` | Date | |

### `requests`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `requestNumber` | string | unique, human-readable — `CLM-2026-000001` / `PRE-2026-000001` |
| `customer` | ObjectId → users | indexed |
| `assignedOfficer` | ObjectId → users \| null | indexed |
| `requestType` | RequestType | |
| `productCategory` | ProductCategory | |
| `policyNumber` | string | |
| `description` | string | 10–2000 chars |
| `incidentDate` | Date | not in the future |
| `serviceProvider` | string? | required for HMO |
| `estimatedAmount` | number | > 0, NGN |
| `status` | RequestStatus | default `SUBMITTED` |
| `documents` | Document[] | embedded, see below |
| `createdAt` / `updatedAt` | Date | |

**Embedded `Document`:**
`{ url, publicId, fileName, mimeType, size, uploadedBy: ObjectId, uploadedAt: Date }`

`publicId` is Cloudinary's — store it so files can be deleted later.

### `auditlogs` (separate collection)

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `request` | ObjectId → requests | indexed |
| `actor` | ObjectId → users | |
| `actorRole` | UserRole | denormalised so history survives role changes |
| `actorName` | string | denormalised snapshot |
| `action` | AuditAction | |
| `fromStatus` | RequestStatus? | |
| `toStatus` | RequestStatus? | |
| `comment` | string? | |
| `metadata` | object? | e.g. `{ fileNames: [...] }` |
| `createdAt` | Date | indexed |

**Append-only.** No update or delete routes, ever.

**Why a separate collection:** it grows unbounded per request, is queried on its own
timeline endpoint, and embedding would bloat every list query. Document this in the
README — it earns data-modelling marks.

### Indexes

```js
users:     { email: 1 } unique
requests:  { customer: 1, createdAt: -1 }
requests:  { status: 1, requestType: 1, productCategory: 1, createdAt: -1 }
requests:  { requestNumber: 1 } unique
requests:  { assignedOfficer: 1, status: 1 }
requests:  { requestNumber: 'text', description: 'text', policyNumber: 'text' }
auditlogs: { request: 1, createdAt: 1 }
```

---

## 6. API contract

Base URL: `${API_URL}/api/v1`
Auth: `Authorization: Bearer <accessToken>` on everything except register/login/refresh.

### Response envelope

**Success**
```json
{ "success": true, "data": { }, "meta": { } }
```

**Paginated** — `meta` carries `{ page, limit, total, totalPages }`.

**Error**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Cannot move a request from APPROVED to UNDER_REVIEW",
    "details": []
  }
}
```

Error codes used: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `INVALID_TRANSITION` (409), `COMMENT_REQUIRED` (400),
`FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (415), `INTERNAL_ERROR` (500).

### Endpoints

#### Auth
| Method | Path | Role | Body / Notes |
|---|---|---|---|
| POST | `/auth/register` | public | `{ email, password, fullName, phone?, policyNumber? }` → creates a **CUSTOMER** only |
| POST | `/auth/login` | public | `{ email, password }` → `{ accessToken, user }` + refresh cookie |
| POST | `/auth/refresh` | cookie | rotates refresh token, returns new access token |
| POST | `/auth/logout` | any | clears refresh cookie, nulls `refreshTokenHash` |
| GET | `/auth/me` | any | current user |

Access token TTL **15m**, refresh token TTL **7d**.

#### Requests
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/requests` | CUSTOMER | creates in `SUBMITTED`, logs `REQUEST_CREATED` |
| GET | `/requests` | both | customer → own only; officer → all + filters |
| GET | `/requests/:id` | both | 403 if customer doesn't own it |
| GET | `/requests/:id/audit-logs` | both | ascending by `createdAt` |
| POST | `/requests/:id/documents` | both | multipart `files` (max 5); logs `DOCUMENT_UPLOADED` |
| POST | `/requests/:id/assign` | OFFICER | 409 if already assigned; → `ASSIGNED` |
| PATCH | `/requests/:id/status` | OFFICER | `{ status, comment? }`; assignee only |
| POST | `/requests/:id/respond` | CUSTOMER | `{ message }` + optional files; only from `NEEDS_ADDITIONAL_INFO`; auto → `UNDER_REVIEW` |
| POST | `/requests/:id/withdraw` | CUSTOMER | only from `NEEDS_ADDITIONAL_INFO` |
| GET | `/dashboard/stats` | OFFICER | bonus |

#### `GET /requests` query params

`status`, `requestType`, `productCategory`, `dateFrom`, `dateTo`, `assignedToMe`
(boolean, officer), `search`, `page` (default 1), `limit` (default 10, max 50),
`sortBy` (default `createdAt`), `sortOrder` (`asc`|`desc`, default `desc`).

Repeated values allowed for `status` (`?status=SUBMITTED&status=ASSIGNED`).

#### `GET /dashboard/stats` response

```json
{
  "totalRequests": 0,
  "byStatus": { "SUBMITTED": 0, "ASSIGNED": 0, "...": 0 },
  "byType": { "INSURANCE_CLAIM": 0, "HMO_PRE_AUTHORIZATION": 0 },
  "approvalRate": 0.0,
  "pendingAssignment": 0,
  "assignedToMe": 0,
  "totalEstimatedValue": 0
}
```

---

## 7. File uploads

- Accepted: `application/pdf`, `image/jpeg`, `image/png`
- Max **5 MB** per file, max **5 files** per upload call
- Validate MIME **and** extension server-side; don't trust the client
- Cloudinary folder: `igi-portal/requests/{requestId}/`
- Upload with `resource_type: 'auto'` so PDFs work
- Store `publicId` alongside `url`
- Uploads are allowed while a request is not terminal

---

## 8. Security requirements

- bcrypt password hashing (cost 10), min 8 chars with letter + number
- Access token in memory on the client; refresh token in an **httpOnly, secure, sameSite=none** cookie
- Refresh token rotation, hashed at rest
- Role guard + **ownership guard** on every request-scoped route — role alone is not enough; a customer with a valid token must not read another customer's request
- `helmet`, CORS restricted to the frontend origin with `credentials: true`
- Rate limit auth routes (10 req / min / IP)
- Never return `passwordHash` or `refreshTokenHash` — strip in a serialisation interceptor, not per-controller
- Validate every ObjectId param; reject malformed ids as 400 not 500

---

## 9. Seed data (required — README must list credentials)

```
officer@igi.test  / Officer123   — role OFFICER, "Adaeze Okonkwo"
officer2@igi.test / Officer123   — role OFFICER, "Tunde Bakare"
customer@igi.test / Customer123  — role CUSTOMER, "Chidi Nwosu", policy IGI-POL-0001
customer2@igi.test/ Customer123  — role CUSTOMER, "Fatima Bello", policy IGI-POL-0002
```

Plus **~12 requests** spread across every status, both request types, several product
categories, with audit trails that look plausible (multi-step histories, not one entry
each) and at least two with uploaded documents. A reviewer landing on an empty dashboard
is a wasted first impression.

Seed must be idempotent — safe to re-run against prod.

---

## 10. Deliverables checklist

- [ ] Publicly accessible URL (frontend), backend reachable and CORS-correct
- [ ] Public repos (frontend + backend), clean commit history
- [ ] README in each: setup, stack + rationale, assumptions, **test credentials**, extras
- [ ] Seeded production database
- [ ] Both roles walk the full happy path end to end on the deployed URL

### Bonus, in priority order
1. Pagination *(do it — it's in the core filter spec anyway)*
2. Search
3. Dashboard metrics
4. JWT refresh tokens *(already in the spec above)*
5. Unit tests on the state machine
6. Docker support
7. Email notification on status change
8. CI/CD

---

## 11. Assumptions to state in the README

1. Officers are seeded by an administrator; the public registration endpoint creates customers only.
2. One assignee per request; no reassignment or hand-off in this prototype.
3. Policy numbers are free text — not validated against any external policy system.
4. Amounts are NGN, stored as a number; production would use minor units or `Decimal128`.
5. Audit entries are append-only and never edited or deleted.
6. Documents are public Cloudinary URLs; production would use signed, time-limited delivery.
7. No multi-tenancy or branch scoping.
8. `WITHDRAWN` is reachable only from `NEEDS_ADDITIONAL_INFO`, per the brief's wording.

---

## 12. Out of scope

Payments/disbursement, provider network management, policy underwriting, claims
adjudication rules engine, notifications beyond optional email, admin user management UI,
i18n, offline support.

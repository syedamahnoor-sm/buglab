# Better Auth ↔ Habin learner backend integration

**Date:** 2026-11-06  
**Branch:** `feature/learner-backend-release` (based on auth tip `c7f311f`)  
**Status:** Integration contract for the learner-backend release. Linking HTTP remains inactive until migration `0003` is jointly applied.

## Ownership

| Codex (PR #10) | Habin (this branch) |
|---|---|
| Better Auth (`buglab_auth_*` tables) | `learners`, sessions, attempts, claims, reflections |
| Account credentials, sessions, email/Google | Anonymous `buglab_learner` cookie |
| `VerifiedAccount` issuance | `account_learner_links` + linking TX (inactive until `0003`) |
| Account UI and `/api/auth`, `/api/account` | Mounted learner/session/completions/Learning Loop HTTP |

## VerifiedAccount

Canonical type: `src/server/auth/verified-account.ts` (Codex).

Fields: `accountId`, `email`, `emailVerified: true`, `displayName`, `role`.

Habin `src/server/identity/verified-account.ts` wraps Codex issuance for the historical `(provider, request)` call shape and `assertVerifiedAccount` for stores. Browser-supplied account id / email / role are never accepted.

Better Auth user ids are opaque strings on `buglab_auth_user.id`. Mapping to `account_learner_links.account_id` (TEXT 1–256, no FK): **use Better Auth `user.id` as `account_id`**. Compatible without a second users table.

## Database variables

| Variable | Owner | Use |
|---|---|---|
| `DATABASE_URL` | Codex Better Auth | Account runtime pool |
| `BUGLAB_DATABASE_URL` | Habin | Learner Postgres (pooled), when selected |
| `BUGLAB_DATABASE_URL_DIRECT` | Habin | Migrations only |
| `BUGLAB_TEST_DATABASE_URL` | Habin | Throwaway test DBs |
| `BUGLAB_DATABASE_POOL_MAX` | Habin | Optional 1–100, default 5 |
| `BUGLAB_AUTH_PROVIDER=better-auth` | Codex | Enables AuthProvider when accounts enabled |
| `BUGLAB_ACCOUNTS_ENABLED=enabled` | Codex | Account activation gate |

Same PostgreSQL instance is fine; separate migrators (`buglab_schema_migrations` vs Better Auth schema script). Do not FK Habin tables into `buglab_auth_*`.

## Migration `0003`

Pending joint apply. Adapter `createSharedLearnerIntegration` exists but is **not** passed to `createAccountHandler()` — account linking returns `unavailable` until wired after `0003` validation.

## Mounted Habin endpoints (this release)

- `GET|POST /api/learner`
- `GET|POST /api/challenges/[challengeId]/session`
- `GET /api/challenges/[challengeId]/attempts`
- `GET /api/learner/completions`
- `GET|POST /api/learning/reflections`
- `GET|PATCH|DELETE /api/learning/reflections/[reflectionId]`
- `GET /api/learning/journal`
- `GET /api/learning/activity`

Default store: **MemoryStore** via `getAppServices()`. Live diagnosis route unchanged (curl/monitor Origin compatibility preserved). Session-path diagnosis factory remains unmounted.

## Not equivalent

Implemented ≠ tested ≠ mounted ≠ Postgres-validated ≠ merged ≠ deployed.

# Migration 0003 vs Better Auth — compatibility review

Status: **compatible schema; do not apply until linking activation.**

Reviewed against Codex Better Auth on `c7f311f` (`buglab_auth_user` and related Better Auth tables) and Habin migration `db/migrations/0003_account_links.sql`.

## Ownership (approved)

| Concern | Owner |
| --- | --- |
| Account, credential, verification, session tables | Codex / Better Auth (`buglab_auth_*`) |
| Learners, sessions, attempts, completions, Learning Loop, `account_learner_links` | Habin |
| Canonical account id | Better Auth `user.id` → opaque `account_id` text |
| Transactional linking, consent, uniqueness, anonymous credential retirement | Habin |

## What 0003 changes

1. Makes the anonymous credential block on `learners` optional (all-or-nothing CHECK).
2. Creates `account_learner_links (account_id PK, learner_id UNIQUE FK → learners, linked_at)`.

## Better Auth interaction

- Better Auth tables use namespaced models (e.g. `buglab_auth_user`). Migration 0003 **does not** create, alter, or foreign-key into those tables.
- `account_id` is opaque `TEXT` (length 1–256) with **no FK** into the provider. That matches `VerifiedAccount.accountId` from `user.id` after server-side session verification (`verifyAccount` / `readAccountSession`).
- Habin and Codex may share one PostgreSQL database or use separate ones; 0003 only touches Habin learner tables.

## Constraints vs auth APIs

| Requirement | Habin 0003 / linking | Better Auth today |
| --- | --- | --- |
| Stable server-resolved account id | `account_id` = verified `user.id` | `session.user.id` string |
| One account ↔ one learner | PK + UNIQUE on link table | N/A (Habin-enforced) |
| Anonymous credential retirement | optional credential columns + link TX | N/A |
| Consent | application layer (`decideLearnerLink`) | N/A |

No conflicting unique indexes or column types found between 0003 and Better Auth’s schema.

## Activation gate (still closed)

Do **not** apply 0003 and do **not** wire `SharedLearnerIntegration` into the account route until:

1. Migrations 0001 / 0002 / 0004 / 0005 validated in the target environment.
2. End-to-end account-linking security tests pass against a DB with 0003 applied in isolation.
3. Joint apply approval for production/shared environments.

Until then, anonymous learner APIs remain mounted; account linking remains disabled.

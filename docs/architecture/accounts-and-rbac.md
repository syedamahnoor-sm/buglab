# Accounts, roles and the admin area

Status: **account workflow implemented, disabled until configured; admin remains unmounted.**
Better Auth and PostgreSQL account/session persistence live in `src/server/account`, behind mounted
`/api/account/*` routes and account pages. Activation requires real database, origin, secret and email
configuration; production has an additional verification gate. See
[the current API contract](account-frontend-contract.md) and
[operations guide](../authentication-operations.md). Shared learner linking awaits Habin's unpublished code.

## 1. Two identities, kept apart

| Identity | What it is | Where it lives |
|---|---|---|
| **Learner** (anonymous) | Progress on challenges, from the `buglab_learner` cookie | Habin's learner-session module (`src/server/session`) |
| **Account** (signed in) | A person, their email and role | `src/server/auth` (this foundation) |

They never share an id or a cookie. `src/server/auth` does not import the learner-session module and does not read its
cookie. A link between them is a separate record (`AccountLearnerLink`), created only by the policy below.

## 2. Linking an account to a learner (`learner-link.ts`)

Progress moves only:

- with the learner's **explicit consent**;
- into an account that **has no learner yet**;
- from a browser learner **no other account has claimed**.

Otherwise the account keeps its own learner and the browser's anonymous progress stays separate. Nothing merges
automatically, so signing in on a shared computer never hands one person's progress to another.

## 3. Roles and permissions (`permissions.ts`)

Default-deny. Anonymous visitors hold no protected permission.

| Permission | learner | admin |
|---|---|---|
| `account:read-own`, `account:update-own` | ✓ | ✓ |
| `admin:access`, `admin:challenges:read`, `admin:challenges:write`, `admin:users:read`, `admin:roles:assign` | | ✓ |

Guards (`guards.ts`) return a 401 when nobody is signed in, and a 403 when the user lacks the permission. A write also
needs the application's own origin first (the shared `isSameOriginRequest`; with no `Origin`, only
`Sec-Fetch-Site: same-origin`). Data access in `src/server/admin` checks the permission again itself, so a route that
forgets its guard still cannot read admin data.

**Registration never sets a role** (`registration.ts`). The input type has no role field; a submitted `role`,
`isAdmin` or similar is dropped and reported, and the account is a learner.

## 4. Choosing the provider

BugLab will not implement passwords, hashing or session cryptography itself. The provider sits behind `AuthProvider`
(`provider.ts`). Requirements:

- maintained, with a database adapter for the store we choose;
- HttpOnly, `Secure`, `SameSite` session cookies, with server-side session revocation;
- CSRF protection, compatible with our same-origin rule;
- runs on the Node.js runtime under Next.js 16 with Cache Components.

Selected: **Better Auth 1.7.18 with PostgreSQL**, using its maintained credential and session implementation,
direct `pg` adapter, email verification/recovery and optional Google OAuth. Compatibility with this
checkout's Next.js 16.4.3 Cache Components architecture is verified by the production build and browser tests.
Provider tables use a `buglab_auth_` prefix and do not replace Habin's learner schema.

### Configuration it will need

| Variable | Purpose |
|---|---|
| `BUGLAB_AUTH_PROVIDER` | Which provider. Unset means unconfigured (everyone refused). An unknown value fails at startup. |
| `DATABASE_URL` | The durable store, shared with learner sessions. |
| The provider's secret (for example `BETTER_AUTH_SECRET` or `AUTH_SECRET`) | Session signing. Never committed; from the deployment's secret store. |
| `BUGLAB_APP_ORIGIN` | Already required for origin checks and `Secure` cookies. |

There is deliberately no in-memory or development account store. Until a provider is configured, `resolveAuthProvider()`
returns the unconfigured provider, and every guard refuses.

## 5. Provisioning the first admin

No admin account, password or email is shipped in code or configuration. Once accounts exist:

1. The person signs up normally and gets a learner account.
2. An operator with database access runs a one-off, audited command inside the deployment (for example
   `npm run admin:grant -- --email <address>`, to be written with the provider integration) that sets that account's
   role to `admin` and records who granted it and when.
3. Later admins are granted through `admin:roles:assign`, never through sign-up input.

## 6. The admin area

Components exist for the frame (`AdminShell`), the inventory (`ChallengeInventory`) and a challenge review
(`ChallengeReview`: a read-only metadata form, the publication readiness checklist and a card preview). The
server-side data (`listAdminChallenges`, `getAdminChallenge`) requires `admin:challenges:read`.

**Read-only, on purpose.** Challenges are registered in code (`src/data/catalog`). A database edit cannot publish
executable challenge content, so there is no save action and no publishing pipeline is pretended.

### Mounting it later

When a provider is configured:

- `src/app/admin/layout.tsx` resolves the session on the server, inside `<Suspense>`, and calls `notFound()` for anyone
  without `admin:access`, so the area does not reveal that it exists.
- Pages read data only through `src/server/admin`, passing the authenticated user.
- Any admin API route uses `requirePermissionForWrite` (origin, then permission), a JSON body and `no-store` responses.
- Add `/admin` to the proxy's matcher so non-admins are refused before any page work.

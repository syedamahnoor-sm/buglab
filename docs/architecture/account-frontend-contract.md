# BugLab account boundary

Implemented in `src/server/account`, with Better Auth 1.7.18 and PostgreSQL.
The original browser client in `src/lib/account` is preserved and connected.
Provider storage is independent of learner storage. No learner migration is
introduced and no anonymous cookie is promoted to an account session.

## Activation

The browser discovers capabilities at `GET /api/account/capabilities`. The
server requires explicit activation, database, secret, exact application origin
and an email adapter. It checks the provider user table before offering forms.
Production additionally requires `BUGLAB_AUTH_PRODUCTION_VERIFIED=enabled`.
There is no memory-account fallback and no public environment flag can activate
the provider. Claude's legacy build-config selector remains available to callers
that deliberately want a disconnected client; the mounted UI does not use it.

## API

Every response uses `Cache-Control: no-store`, `Vary: Cookie`, and
`Referrer-Policy: no-referrer`. Writes require JSON, reject prefetch and require
the exact configured Origin, or `Sec-Fetch-Site: same-origin` when Origin is
absent. Bodies are limited to 16 KiB. Inputs use an explicit allowlist.

| Method and path under `/api/account` | Input | Successful response |
| --- | --- | --- |
| GET `/capabilities` | none | `{ available: true, google, linking }` |
| GET `/session` | account cookie | `{ session: AccountSession \| null }` |
| POST `/sign-up` | email, password, optional displayName | `{ status: "verification-required" }` |
| POST `/sign-in` | email, password | `{ session: AccountSession }` and provider cookies |
| POST `/sign-out` | account cookie | `null`, revoked session and cleared cookies |
| POST `/verify-email` | token | `null` |
| POST `/verify-email/resend` | email | `null` |
| POST `/password/forgot` | email | `null`, including unknown addresses |
| POST `/password/reset` | token, password | `null`; consumes token and revokes sessions |
| POST `/password/change` | currentPassword, newPassword | `null`; revokes other sessions |
| PATCH `/profile` | displayName | `{ user: AccountUser }` |
| GET `/sessions` | account cookie | `{ sessions: AccountSessionSummary[] }` |
| DELETE `/sessions/:id` | own session id | `null` |
| POST `/sessions/revoke-others` | account cookie | `null` |
| POST `/oauth/google` | optional safe `next` path | `{ url }` and OAuth state cookie |
| GET `/link` | account cookie | `LinkStatus`, only when the shared adapter is supplied |
| POST `/link` | literal `consent: true` | `{ outcome: LinkOutcome }`, only with the shared adapter |

Failures have `{ status: "error", code, fields? }`. Codes map provider errors
to the browser client's vocabulary. Authentication failures are 401,
insufficient permission/cross-origin writes are 403, invalid input is 400,
throttling is 429, and unavailable dependencies are 503. Transport exceptions
are never serialized. Rate-limit retry headers are preserved.

## Identity and session contract

`AccountSession` contains only user id, email, optional display name,
emailVerified, learner/admin role, supported sign-in methods, creation time and
session expiry. It never includes a session token, password hash, OAuth token,
IP address or raw user agent. Session summaries expose opaque row ids, not
credentials. Revocation resolves that id within the caller's own sessions.

Roles are database/provider-issued. The provider's role field has `input: false`
and defaults to learner. Registration and profile payloads cannot assign it.
Server guards reject expired sessions; unknown roles fail closed.

Passwords use Better Auth's maintained default hashing. The boundary and forms
enforce 12–128 UTF-16 code units, matching this provider version. Email
verification is required before password sign-in. Verification links expire in
one hour; reset links expire in 30 minutes. Reset tokens are consumed by the
provider and existing sessions are revoked. Signup/recovery acknowledgements do
not disclose whether an address is registered.

Account cookies use their own `buglab_account` prefix, host-only scope, `/`,
HttpOnly, Secure on HTTPS/production, and SameSite=Lax. Lax supports Google's
top-level callback; exact-origin JSON writes and provider OAuth state supply
the additional CSRF protections. Sessions last seven days, renew after one day,
and require a recent session for sensitive provider operations. Cookie session
caching is disabled so revocation and database expiry remain authoritative.

The only public provider endpoint is `GET /api/auth/callback/google`.
Provider signup, signin, arbitrary callbacks, role updates and token endpoints
are not mounted publicly. OAuth starts through the same-origin BugLab POST.
Google is offered only when both credentials are present. OAuth tokens are
encrypted by the provider; automatic provider-account linking is disabled.

## Shared learner integration remains blocked

The four documents in Downloads describe implementations not available in this
checkout: PostgreSQL learner/link stores, `VerifiedAccount`, link transactions,
migrations 0001–0005 and Learning Loop services. The available remote backend
branch previously available was `origin/feature/learner-session-backend-integration` at
`9e47d6c3b4d11f3b061399b4333f88cf3c946169`; it does not contain those modules.
Habin has now confirmed his working branch is `feature/durable-learner-session-store`,
based on `d73abce361fee9b7301fc436676b1d433d5eaec8`. That baseline commit exists locally
and contains no durable learner/linking implementation. His latest work remains
uncommitted and unpushed, and has not been imported or assumed present.

`SharedLearnerIntegration` is an intentionally inactive adapter port. Codex owns
`src/server/auth/verified-account.ts`: `verifyAccount(request)` reads a live provider
session and issues an immutable `VerifiedAccount` containing `accountId`, `email`,
`emailVerified: true`, `displayName` and a server-resolved `role`. The proof has a
private type brand plus runtime WeakMap issuance, expiry and request binding;
copies, JSON objects and forged headers do not issue a proof. Habin's adapter
must import this contract and check `isVerifiedAccount(account, request)` at entry.
It must prove the live anonymous cookie, honor explicit
consent, enforce one account/one learner, and atomically retire the anonymous
credential after creating a readable link. It must use the excluding purge.
The route clears the anonymous cookie only after a successful adapter result.
Migration `0003_account_links.sql` requires joint review and is not supplied or applied here.

Without this adapter, linking returns 503 and the UI offers no linking button.
The tests prove HTTP authentication/consent gating using a test adapter; they
do not claim to validate the unavailable shared database transaction.

Journal, Progress and its existing Learning Path continue using their current
local learning model. Signed-in context explicitly explains that these records
remain browser-local. No progress database, completion import, ownership claim
or cross-device synchronization is fabricated. Account-scoped server learning
reads await Habin's actual implementation and canonical completions endpoint.

## Browser state

The global account provider restores sessions over the HTTP boundary, refreshes
on focus/visibility, broadcasts identity changes without credentials and
rechecks at expiry. Account forms/caches unmount when identity is uncertain or
changes. Protected pages verify the session on the server inside Suspense,
compatible with Next.js Cache Components. No authenticated result uses server
cache directives. Safe return paths reject external destinations and auth/API
loops. Email tokens are read from a fragment, removed from the address bar and
submitted only after an explicit action.

References: [Better Auth PostgreSQL](https://better-auth.com/docs/adapters/postgresql),
[Next.js integration](https://better-auth.com/docs/integrations/next),
[email/password](https://better-auth.com/docs/authentication/email-password).
Implementation compatibility was also checked against the installed Next.js
16.4.3 guides, including authentication with Cache Components and runtime
segment configuration. Cache Components uses the default Node.js runtime;
explicit runtime segment exports are unsupported here.

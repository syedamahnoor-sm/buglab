# Authentication setup and deployment

Authentication is implemented but disabled until real infrastructure is supplied.
Do not set the production verification gate based only on local fixture tests.
No deployment database or Google/email credentials are included in this worktree.

## Local configuration

Set these in your shell or an ignored `.env.local`. Next.js loads `.env.local`
for the app. The standalone schema command requires exported environment
variables (or Node's `--env-file=.env.local` flag on its invocation).

| Variable | Required value or purpose |
| --- | --- |
| `BUGLAB_AUTH_PROVIDER` | `better-auth` |
| `BUGLAB_ACCOUNTS_ENABLED` | `enabled` when deliberately activating |
| `DATABASE_URL` | Operator-supplied PostgreSQL URL; use verified TLS for remote databases |
| `BETTER_AUTH_SECRET` | At least 32 characters; generate with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` and store privately |
| `BUGLAB_APP_ORIGIN` | Exact origin, with no trailing slash/path; HTTPS in production |
| `BUGLAB_EMAIL_MODE` | `capture` only for local development; otherwise configure SMTP |
| `BUGLAB_DEV_MAIL_DIRECTORY` | Optional private development capture directory; default `.buglab-dev-mail` |
| `BUGLAB_SMTP_HOST` | SMTP host (takes precedence over capture) |
| `BUGLAB_SMTP_PORT` | Defaults to 587 with required STARTTLS; 465 uses TLS immediately |
| `BUGLAB_SMTP_USER`, `BUGLAB_SMTP_PASSWORD` | SMTP authentication when required |
| `BUGLAB_EMAIL_FROM` | Authorized sender address/name |
| `BUGLAB_TRUSTED_PROXY_HOPS` | Existing proxy contract: trusted forwarding hops, only after verifying deployment topology |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional; both needed for Google login |
| `BUGLAB_AUTH_PRODUCTION_VERIFIED` | Leave unset until deployment/integration verification is complete; `enabled` then permits production activation |

Never prefix secrets with `NEXT_PUBLIC_`. Do not paste credentials, captured
emails or tokens into session logs. Local capture writes private ignored JSON
files and never exposes a mailbox HTTP endpoint or prints email links. Open the
captured verification/reset link locally to exercise the real provider flow.
Capture mode is refused in production.

SMTP production delivery requires a real service, authorized sender and working
TLS. Confirm delivery to an external mailbox, including spam-folder behavior.
The app awaits delivery and does not deliberately return success on a delivery
exception. A mail failure can leave an unverified account, which can use resend.
Use deployment log redaction for request bodies, cookies, SQL URLs and tokens.

## Provider schema

No migration runs during startup, a request, a build or dependency installation.
The command uses the pinned provider's schema generator and refuses tables
outside the `buglab_auth_` prefix. It does not apply Habin's migrations.

1. Configure the real PostgreSQL connection and account settings.
2. Run `npm run auth:schema` to inspect generated SQL without applying it.
3. Review it with the database owner against the actual migration baseline.
4. Run `npm run auth:schema -- --apply` to apply only the provider tables in a
   transaction. The command takes a provider-specific advisory lock.
5. Confirm a second plan is empty and restrict the runtime DB role to its needed
   permissions. Use separate schema-migration privileges where appropriate.

Provider-owned tables are `buglab_auth_user`, `buglab_auth_session`,
`buglab_auth_account`, `buglab_auth_verification`, `buglab_auth_rate_limit`.
No learner tables or numeric learner migration names are introduced. Keep the
secret stable between deploys; rotating it invalidates signed provider material
and encrypted OAuth tokens and requires a planned provider migration.

## Google configuration

Register the exact deployed origin and callback
`https://YOUR_HOST/api/auth/callback/google` in Google Cloud. Local credentials
need the corresponding `http://localhost:PORT/api/auth/callback/google` URL.
The button is hidden without both environment values. Validate callback state,
verified email and account-conflict behavior against a real Google account
before announcing this sign-in option. Automatic provider-account linking is
disabled: two accounts are never merged just because an email matches.

## Admin provisioning

Signup always creates a learner. There is no public role-assignment API or UI.
An authorized database operator may provision an existing, email-verified user
by changing only `buglab_auth_user.role` to `admin` in a parameterized, audited
operator transaction. Record the grant in the deployment's operator audit trail
and revoke the user's existing sessions. No default admin is shipped. Existing
admin UI remains unmounted and read-only; mounting it is separate from learner
authentication. Account deletion and email-address changes are not offered;
their learner-history retention policy still needs joint approval.

## Rate limiting and proxies

Better Auth uses PostgreSQL rate-limit buckets, including login, signup and
email/recovery requests. Internal IP headers are overwritten, not trusted from
the caller. With configured trusted hops, the existing BugLab proxy resolver
selects the trusted client address. Without trustworthy IP information, the
provider uses a conservative shared per-path bucket. This prevents bypass via
forged forwarding headers but limits all users together; configure the real
proxy topology and edge abuse protection before a public launch.

## Validation

`npm run test:auth` creates a fresh real PostgreSQL test cluster with randomly
generated test-only credentials. It exercises provider hashing, persistence,
verification, login/logout, recovery/reset, expiration, authorization,
revocation isolation, rate limiting and consent gating. It never uses an
existing deployment database. The test-only embedded PostgreSQL package must
have its platform binaries installed and allowed to start subprocesses.

`npx playwright install chromium` installs the browser. Then
`npm run test:auth:browser` starts its own Next.js process and PostgreSQL cluster,
captures test emails in a private temporary directory, and drives actual forms.
It stops only its own processes and removes only its own generated fixture
directory. Traces, screenshots and video are disabled because flows contain
credentials and token fragments. Test output is ignored by Git.

Also run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
The existing next/font setup needs access to Google Fonts during a build.

Validated on November 6, 2026 with Node 24.20.0: all 2,832 regression tests,
65 focused authentication tests (including real PostgreSQL), four browser
workflows, lint, typecheck and the production build passed. Empty login forms
were visually reviewed in light/dark themes at 1280px and 390px. Shared learner
transactions and real Google/SMTP delivery are not covered by those fixture
results and remain integration/deployment checks.

The dependency audit reported existing Monaco/DOMPurify and lint-tree
advisories; no Better Auth advisory was reported. No forced dependency downgrade
or unrelated Monaco change was made. Review those existing advisories as part
of deployment verification.

## Remaining deployment and shared-learning work

Habin's working branch is `feature/durable-learner-session-store`, based on
`d73abce361fee9b7301fc436676b1d433d5eaec8`. His durable-store/linking changes remain
uncommitted and unpushed. Obtain the actual implementation commit before integrating;
the baseline alone does not supply those modules. Review real migration ordering
and store activation, including joint review of `0003_account_links.sql`.
Supply his implementation of `SharedLearnerIntegration` to the account handler,
using Codex's `src/server/auth/verified-account.ts` identity proof and Habin's link transaction. Do not replace it with an
in-memory link or a second learner table. Verify cookie retirement, replay,
concurrent linking, no-transfer/no-merge conflicts and excluding purge against
his actual PostgreSQL implementation. Connect account-scoped learning reads
through his linked learner and existing completion/Journal/activity services.

Finally verify real database TLS/migrations, external email delivery, HTTPS
cookies, origin/proxy handling, sign-in across app instances, reset delivery,
revocation, linking and deployed authorization. Only then set the production
verification gate. Google may stay unconfigured without blocking email login.

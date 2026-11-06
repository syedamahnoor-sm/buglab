# Authentication setup and deployment

Authentication requires explicitly configured real infrastructure.
Do not set the production verification gate based only on local fixture tests.
No production database, Google or SMTP credentials are committed.

### Persistent Windows development preview

The November 6 preview at port 3200 was a development server without the five
required account variables or an email adapter, so it correctly returned 503
and hid registration. No security gate was removed to fix it.

With the locked development dependencies already installed, run
`npm run auth:dev` to initialize an isolated, real PostgreSQL cluster and start
Next.js on port 3200. Use `npm run auth:dev -- --setup-only` when a development
preview is already running; Next.js reloads the generated `.env.local`.
`--port 3201` selects a different preview origin. This Windows helper generates
new random local credentials, binds PostgreSQL to loopback only, applies only
the five provider tables in its owned cluster, and uses development email
capture. It refuses an existing environment targeting a different database or
secret. It never connects to Habin's database or runs learner migrations.

The ignored `.buglab-dev-auth/` directory contains ownership metadata, secrets
and persistent PostgreSQL data. The ignored `.env.local` configures this preview;
`.buglab-dev-mail/` contains private verification/reset messages. Keep all three
private and out of logs and Git. Capture is a real testing delivery adapter,
not external mailbox delivery. Open the captured link privately to verify an
account or reset its password. Do not share token URLs or captured messages.

`npm run auth:doctor` reports configuration presence and checks the five tables
without printing secrets. `npm run test:auth:local` exercises signup through
recovery against the running localhost:3200 preview with a unique test account.
It leaves that test account in the local database and never resets user data.
PostgreSQL persists after Next.js stops. To stop only this owned database,
run `npm run auth:dev -- --stop-database`; restarting the helper preserves it.
Production activation stays unset, and capture remains forbidden in production.

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

No migration runs during application startup, a request, a build or dependency
installation. The explicit `auth:dev` provisioning helper applies provider
tables only to the isolated database it owns, as described above.
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
It uses a separate ignored `.next-auth-test/` output, so the developer preview
can remain running. It stops only its own processes and removes only its own generated fixture
directory. Traces, screenshots and video are disabled because flows contain
credentials and token fragments. Test output is ignored by Git.

Also run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
The existing next/font setup needs access to Google Fonts during a build.

Initial validation on November 6, 2026 with Node 24.20.0: all 2,832 regression
tests, 65 focused authentication tests (including real PostgreSQL), four browser
workflows, lint, typecheck and the production build passed. Empty login forms
were visually reviewed in light/dark themes at 1280px and 390px. Shared learner
transactions and real Google/SMTP delivery are not covered by those fixture
results and remain integration/deployment checks. The account UI follow-up also
verified a real persistent localhost:3200 database with signup, captured-mail
verification, login, account-menu logout, recovery and reset. The expanded five
fixture browser workflows cover guest discovery, account menus, keyboard use,
mobile layouts, themes, profile/password changes, restoration and expiry.

Final follow-up validation against main `ebb6cfd`: lint, typecheck and production
build passed; all 3,172 regression tests passed with
`node --import ./tests/setup/register.mjs --test --test-concurrency=4 "tests/**/*.test.ts"`.
The default-concurrency run hit a test-worker shutdown stall; its owned process
was stopped and the bounded run completed normally. All 65 focused auth tests,
five fixture browser workflows, one actual localhost preview workflow and 20
desktop/mobile production smoke checks passed. Two deployment API smoke checks
were intentionally skipped without an integrated target. No learner PostgreSQL
deployment or transactional linking activation is claimed by these results.

The dependency audit reported existing Monaco/DOMPurify and lint-tree
advisories; no Better Auth advisory was reported. No forced dependency downgrade
or unrelated Monaco change was made. Review those existing advisories as part
of deployment verification.

## Remaining deployment and shared-learning work

Habin's published learner backend is now included in main through PR #13,
merge `ebb6cfd`. This UI follow-up preserves those modules and migrations
unchanged; its local bootstrap creates only provider tables, and account linking
remains disabled. Review real migration ordering and store activation, including
joint review of `0003_account_links.sql`, before enabling transactional linking.
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

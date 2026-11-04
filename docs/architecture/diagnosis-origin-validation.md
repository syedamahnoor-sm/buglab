# Diagnosis API origin validation

`POST /api/challenges/:challengeId/diagnosis` accepts browser submissions only
from the app's own origin. The policy lives in `src/server/diagnosis/origin.ts`.
The request and response contract is unchanged: a rejected request still gets
`403 { status: "error", message: "Cross-origin submissions are not allowed." }`,
after the `415` content-type check and before anything is counted or a cookie
is set.

## Configuration

| Variable | Required | Example | Effect |
|---|---|---|---|
| `BUGLAB_APP_ORIGIN` | In every deployment | `https://buglab.example` | The only origin accepted. Also makes the attempt cookie `Secure` when it is `https`. |

- It must be exactly an origin: scheme, host and optional port. A path, a
  trailing slash or anything unparsable throws when the route loads, so a typo
  fails loudly instead of changing what is accepted.
- It is normalized: `https://BugLab.Example:443` is the same as
  `https://buglab.example`.
- With multiple public hostnames, pick one canonical origin and redirect the
  others to it. A list of origins is not supported.

## Rules

1. `Sec-Fetch-Site`, when present, must be `same-origin`. Browsers set it and
   pages cannot change it.
2. `Origin`, when present, must equal the expected origin exactly: same scheme,
   hostname and effective port. `null`, malformed values, credentials, paths
   and non-http(s) schemes are rejected.
3. The expected origin is `BUGLAB_APP_ORIGIN`. `Host`, `X-Forwarded-Host` and
   `X-Forwarded-Proto` are not used.
4. A request with neither header is accepted (see below).

## Missing Origin

Current browsers send `Origin` on every POST and `Sec-Fetch-Site` on every
request, and a cross-site JSON POST needs a CORS preflight that this API never
grants. A request with neither header therefore comes from a non-browser client
(curl, a script, a monitor, a test). Those clients can send any header, so
rejecting them would add no protection and would break legitimate tools. They
are still subject to validation and rate limits.

## Development fallback (no `BUGLAB_APP_ORIGIN`)

Local development works without configuration. The expected origin is then the
`Host` header (or the request URL's host) under the Origin's own scheme, which
has two known limitations:

- `Host` is client-controlled, so a non-browser client can send a matching
  `Host` and `Origin`. Browsers cannot set `Host`.
- The public scheme is unknown, so `http://host` and `https://host` look alike.
  `Sec-Fetch-Site` still rejects that mismatch in current browsers.

The attempt cookie's `Secure` attribute then follows the request URL's scheme,
which Next.js derives from the socket or from `X-Forwarded-Proto`. Behind a
TLS-terminating proxy that omits it, the cookie loses `Secure`. Configure
`BUGLAB_APP_ORIGIN` in every deployment.

# Verified completions: integration and activation

Status: **frontend ready, not connected.** No completions route is mounted. Every production build uses the
not-connected source and makes no request. The proposed endpoint below must be reviewed with the backend before
anything is activated.

## How it fits together

| Piece | File | Role |
|---|---|---|
| Model | `src/lib/verified/model.ts` | `VerifiedCompletion` (`challengeId`, `completedAt`, `contentVersion`), the states, normalisation |
| Contract | `src/lib/verified/contract.ts` | The proposed response shapes and their parser |
| HTTP source | `src/lib/verified/http-source.ts` | One same-origin `GET`, with a timeout; failures become states |
| Activation | `src/lib/verified/config.ts` | Picks the source for the build: HTTP only if enabled outside production |
| Merge | `src/lib/progress/completions.ts` | Browser-only, verified, or verified-elsewhere per challenge |
| UI | `src/components/progress/` | A status line, the solved split, and "Verified" markers |

**States:** `not-connected`, `loading`, `no-learner`, `expired`, `unavailable` (with a reason) and `ready`. Only
`ready` can mark a challenge verified, and only for challenges on the server's list.

## Proposed contract (to review)

`GET /api/learner/completions`, same-origin, with the HttpOnly learner cookie:

- `200 { "learner": { "state": "active" }, "completions": [{ "challengeId", "completedAt", "contentVersion" }] }`
- `200 { "learner": { "state": "none" | "expired" }, "completions": [] }`, or
- `401 { "status": "error", "code": "learner-missing" | "learner-expired", "message" }`, as the session handlers send today
- `403`, `404`, `429` and `5xx` are shown as unavailable; any other body is rejected as an invalid response

Open questions for the backend:

1. Path and shape: a separate route, or completions included in `GET /api/learner`?
2. Learner errors: `401` with a code, or `200` with the learner state? The parser accepts both; pick one.
3. Are completions on older content versions listed? (Assumed yes: a completed session keeps its result.)
4. Is pagination needed? (Assumed no: at most one entry per published challenge.)
5. Headers: `Cache-Control: no-store`? Do the same Origin and `Sec-Fetch-Site` checks apply to this `GET`?

## Activation checklist

**Backend (Habin)**

- [ ] Route implemented and mounted to the agreed contract; read-only, and it never creates a learner
- [ ] Lists completed sessions only, for published challenges only, with no resolution, feedback or submission
- [ ] Learner missing and expired answered as agreed; rate limiting in place; `no-store`
- [ ] Contract tests: `tests/verified/contract.test.ts` checks its fixtures against the real handlers; extend it to call the new route

**Frontend**

- [ ] Update `contract.ts` and the fixtures in `tests/verified/fixtures/` if the agreed contract differs
- [ ] Try it locally against that backend: `NEXT_PUBLIC_BUGLAB_VERIFIED_COMPLETIONS=enabled npm run dev`, then open `/progress`
- [ ] Check each state on the page (ready, no learner, expired, unavailable) and that browser progress is unchanged
- [ ] Agree reconciliation rules before server completions affect streaks or activity history (today they do not)
- [ ] Production activation: change `resolveVerifiedSourceConfig` deliberately (it refuses production builds today), with tests updated to match

**Must stay true**

- [ ] A browser solve is never shown as verified unless the server lists it
- [ ] Verified data is never written into the browser's learning record, and local reflections are never sent to the server
- [ ] Reflections, recall, practice, the Journal, streaks and the activity calendar stay browser-local
- [ ] No unpublished challenge and no answer-key text reaches the page; the leak scan stays at 0

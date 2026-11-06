# Recommendation API v1

**Mounted:** `/api/recommendations/v1`. **Version:** 1.
GET and POST calculate recommendations without writing progress, identity,
accounts, cookies, a database, or Learning Loop data. This is a recommendation
endpoint, not a mounted learner API. There is no separate service or paid model.

## GET: catalog starting points

```text
GET /api/recommendations/v1
GET /api/recommendations/v1?category=frontend&difficulty=beginner&minutes=20&stretch=0&today=2026-11-06
```

All query fields are optional. Unknown/repeated fields are rejected. Category
must be one of the six public category IDs; difficulty is beginner/intermediate/
advanced; minutes is an integer 5–180; stretch is exactly `0` or `1`; today is a
real `YYYY-MM-DD` calendar day. An omitted day does not invent a learner timezone.
GET supplies no browser activity and never creates a learner.

## POST: explicitly browser-local guidance

`Content-Type: application/json` (optional charset). All fields below are
required; null means no preference. Unknown properties at every input level
are rejected. Do not submit a whole LearningRecord or verified-completion view.

```json
{
  "version": 1,
  "today": "2026-11-06",
  "preferences": {
    "category": "frontend",
    "difficulty": "beginner",
    "minutes": 20,
    "allowStretch": false,
    "useLocalSignals": true
  },
  "local": {
    "status": "ready",
    "solves": [],
    "recalls": [],
    "practiceRequests": []
  }
}
```

- `today`: a real local calendar day, or null (no due-recall calculation).
- `preferences.category`: a public category ID or null; a soft focus.
- `preferences.difficulty`: supported tier or null; preferred tier/upper bound.
- `preferences.minutes`: integer 5–180 or null; soft catalog-estimate budget.
- `allowStretch`, `useLocalSignals`: strict booleans, no coercion.
- `local.status`: `ready`, `partial`, or `unavailable`.
- `solves`: at most 300 `{challengeId,lastSolvedAt}` local observations; UTC
  ISO instants, not server completion timestamps. Source remains browser-local.
- `recalls`: at most 100 `{challengeId,dueOn}` existing browser schedule entries;
  dates are validated and future entries are not due.
- `practiceRequests`: at most 100 challenge IDs whose local recalls requested
  practice. These are self-reports, not failed diagnosis attempts.
- IDs: lowercase hyphenated strings, maximum 100 characters. Unknown IDs are
  ignored by eligibility; the browser adapter additionally suppresses all IDs
  outside the published/playable allow-list before transmission.
- `unavailable` local data must contain empty lists. Partial data never establishes
  missing-category coverage. Disabling local signals ignores all local evidence.

Body size is bounded to 32,768 UTF-8 bytes, including streamed bodies without a
Content-Length header. Body reading has a five-second deadline. Invalid JSON,
UTF-8, dates, shapes, types, versions, counts, and properties are rejected.

Requests containing `verified`, `learnerId`, `accountId`, catalog content, private
reflection fields or credential fields are invalid. Merely labelling a browser
observation verified cannot bypass this boundary.

## Response: RecommendationPlan

Success is 200, including a useful cold start or a plan with unavailable sources.
The TypeScript contract is `src/lib/recommendations/types.ts`:

- `version: 1`, `strategy: deterministic-v1`.
- `mode`: cold-start, personalized, or limited-data. Not a confidence score.
- `target`: difficulty and basis (default/preference/verified-exposure).
- `evidence`: separate verified-source and local-source statuses.
- `availableCount`, `eligibleCount`: public availability and eligible new work.
- `next`: first path item, or null.
- `path`: zero to five distinct challenge recommendations.
- `practice`: zero to three highlights of other steps already in that path.
  Across next/path/practice there are at most five distinct new-work IDs.
- `recalls`: existing due/overdue browser recalls, ordered oldest first; separate
  from new work. Their challenge may be completed, but is never new-work eligible.
- `notices`: typed history/storage limitations. Missing data is not empty history.

Challenge recommendations contain a public metadata allow-list, bounded scoring
factors and typed factual reasons. Reasons have codes/bases and numeric/date/
category parameters; no arbitrary server prose, user writing or grading fields.
The UI renders owned templates from `reasons.ts`. Scores are internal ordering
values, not measured skill, success rates or probabilities.

Unknown/unpublished IDs, account identity, raw completion objects, private
reflections, resolution text, feedback, submissions and hidden grading data are
never serialized in a successful recommendation response.

## Errors and privacy

```json
{"version":1,"error":{"code":"invalid-request","message":"The recommendation request is invalid."}}
```

| Status | Code / meaning |
|---|---|
| 400 | invalid-request: unsupported fields, invalid query/body/version |
| 403 | refused: cross-site Fetch Metadata or mismatched Origin |
| 405 | unsupported HTTP method (Next handles methods not exported by the route) |
| 408 | request-timeout: body read deadline |
| 413 | payload-too-large: declared or actual byte limit |
| 415 | unsupported-media-type |
| 503 | recommendations-unavailable: catalog/engine failure |

Error bodies never echo request values, exception messages, provider failures,
credentials or reflection writing. Provider failure normally returns a 200
limited-data/cold-start plan with verified status unavailable, not a fabricated
ready/empty result. No request bodies are logged by feature code.

GET/POST responses and feature errors use `Cache-Control: private, no-store,
max-age=0`, `Pragma: no-cache`, `Vary: Cookie, Authorization, Origin`, and nosniff.
No CORS access is granted. The initial browser client uses `credentials: omit`
and `cache: no-store`. No per-learner or personalized module-level cache exists.

## Authenticated integration boundary

`createRecommendationHandler` accepts an internal `VerifiedHistoryProvider`.
The mounted route deliberately uses its disconnected default. The provider must
resolve the authorized subject through Claude/Habin's agreed identity layer;
body IDs or arbitrary headers are not identity. Results are sanitized and used
only for the current request. `ready` explicitly declares complete/partial
coverage and carries only authoritative completion DTOs. Other states remain
not-connected/no-learner/expired/unavailable.

Optional future difficulty evidence must name the same completed challenge and
content version and its actual historical difficulty. It cannot be inferred
from today's catalog or from local solve counts. Conflicting evidence is ignored.

Before activation, agree authorization, persistence, local-data consent,
identity-change invalidation, credential policy and same-origin protections.
Do not mount shared learner routes, link accounts, read private reflections,
activate production services or add a database as part of this feature.
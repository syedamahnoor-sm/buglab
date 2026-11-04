# Authoring a challenge

A challenge is two files under `src/data/challenge-NNN/` and two registration lines.

## 1. The public scenario: `index.ts`

Write it with `defineChallenge` (`src/lib/authoring/define-challenge.ts`). Everything in it is
learner-visible, so it must not name or hint at the cause. The helper:

- numbers log lines `log-01`, `log-02`, ... and also writes them to a log file (`logs/app.log`
  by default; `logFile` changes it, `null` leaves it out);
- for a request tied to an `[http]` log line (`log: n`, where the message reads
  `METHOD /path STATUS Nms`), takes the time, method, path and status from that line, and sets the
  browser duration to at least the server's;
- numbers requests `req-01`, ... and fills in the URL, status text and the usual headers.

Only `GET` and `POST` requests can be captured. Keep log lines and requests in time order, on the
single `incidentDate`.

## 2. The private answer key: `answer-key.server.ts`

Write it with `defineAnswerKey` (`src/server/content/define-answer-key.ts`). It starts with
`import "server-only"` and is never imported by public code. It names:

- `correctRootCauseId`, one of the scenario's options;
- `resolutionSummary`, shown only after a correct diagnosis;
- `observations`, the key evidence by position (`logs: [3]`, `requests: [2]`); each piece of
  evidence may belong to only one observation;
- `investigationHints`, shown after any wrong diagnosis. They are the same for every wrong option,
  so they must describe how to investigate, never the answer;
- `revision`. Bump it whenever anything in the key changes.

## 3. Register it

- `src/data/catalog/index.ts`: add the scenario to `REGISTERED_CHALLENGES` (public).
- `src/server/content/index.ts`: add the answer key to `AUTHORED_CHALLENGES` (server-only), in
  the same order.
- `tests/challenges/revision-pin.test.ts`: add the pin the test prints for the new challenge.

The catalog, Challenge Library, routes, proxy allow-list, live diagnosis registry and the challenge
registry all pick the challenge up from these lists. No page or component changes.

## 4. Check it

`tests/content/authored-challenges.test.ts` runs over every authored challenge. It checks:

- both lists name the same challenges, in the same order;
- each request agrees with its log line;
- logs and requests are in time order;
- there are enough code files, log lines and options;
- nothing public contains the answer;
- the correct option's position varies across challenges;
- no two challenges duplicate content;
- grading through the live endpoint works: correct answers are confirmed with full coverage, and
  every wrong option gets the same feedback with the challenge's hints.

## Known limitation

The live diagnosis route passes `investigationHintsFor(challengeId)` to the evaluator. The learner
session service (not mounted yet) calls the evaluator without hints, so learner sessions would show
the generic hints until it passes them too.

/*
 * A worker for restart.test.ts: one phase of a learner's journey, run in its OWN operating-system process, so
 * that the test can kill the process between phases and prove the state really lives in the database.
 *
 *   write  starts a learner and a challenge, submits one wrong and one correct diagnosis through the real
 *          diagnosis handler, and prints what it saw as one line of JSON.
 *   read   in a FRESH process, with a new pool and a new store and no memory of the first, uses the cookie
 *          the first one issued to read the learner, session and attempts back, then repeats submissions.
 *
 * Not a test file (no `.test.ts` suffix). Configuration arrives in the environment, never on the command line:
 *   WORKER_DATABASE_URL   the connection string of the test database
 *   WORKER_STATE          for `read`: the JSON the `write` phase printed
 */
import { createAppServices } from "@/server/app-services";
import { createPostgresPersistence } from "@/server/db/persistence";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { CHALLENGE_ID, CORRECT_ID, WRONG_IDS, submission } from "../diagnosis/fixtures";

const ORIGIN = "http://localhost:3000";
const KEYS = { wrong: "0a0b0c0d-0000-4000-8000-000000000001", correct: "0a0b0c0d-0000-4000-8000-000000000002", fresh: "0a0b0c0d-0000-4000-8000-000000000003" };

const persistence = createPostgresPersistence({
  config: { connectionString: process.env.WORKER_DATABASE_URL as string, poolMax: 2 },
});
const services = createAppServices({ store: persistence.store });

async function diagnose(cookie: string, key: string, rootCauseId: string) {
  const request = new Request(`${ORIGIN}/api/challenges/${CHALLENGE_ID}/diagnosis`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${LEARNER_COOKIE}=${cookie}`,
      "idempotency-key": key,
    },
    body: JSON.stringify(submission({ rootCauseId })),
  });
  const response = await services.diagnosis(request, { params: Promise.resolve({ challengeId: CHALLENGE_ID }) });
  return { status: response.status, body: await response.json() };
}

try {
  const phase = process.argv[2];
  if (phase === "write") {
    const { cookie } = await services.service.startLearner(undefined);
    const started = await services.service.startChallenge(cookie.value, CHALLENGE_ID);
    const wrong = await diagnose(cookie.value, KEYS.wrong, WRONG_IDS[0]);
    const correct = await diagnose(cookie.value, KEYS.correct, CORRECT_ID);
    process.stdout.write(`${JSON.stringify({ cookie: cookie.value, started, wrong, correct })}\n`);
  } else if (phase === "read") {
    const { cookie } = JSON.parse(process.env.WORKER_STATE as string) as { cookie: string };
    const learner = await services.service.checkLearner(cookie);
    const session = await services.service.getChallengeSession(cookie, CHALLENGE_ID);
    const attempts = await services.service.listAttempts(cookie, CHALLENGE_ID);
    const replayWrong = await diagnose(cookie, KEYS.wrong, WRONG_IDS[0]);
    const replayCorrect = await diagnose(cookie, KEYS.correct, CORRECT_ID);
    const afterCompletion = await diagnose(cookie, KEYS.fresh, WRONG_IDS[1]);
    process.stdout.write(`${JSON.stringify({ learner, session, attempts, replayWrong, replayCorrect, afterCompletion })}\n`);
  } else {
    throw new Error(`Unknown phase: ${phase}`);
  }
} finally {
  await persistence.close();
}

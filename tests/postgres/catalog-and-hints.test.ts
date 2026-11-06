/*
 * The catalog-compatibility and investigation-hints contracts on REAL PostgreSQL, plus what only a database can show:
 * that every challenge's id and content version are stored as they are, that a refusal or a replay changes no row, and
 * that hints are never written to the database.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createAppServices, type AppServicesOptions } from "@/server/app-services";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { publishedChallengeIds } from "@/server/diagnosis/published";
import { AUTHORED_CHALLENGES } from "@/server/content";
import { allCases, catalogAndHintsContract, type Harness } from "../session/catalog-and-hints-contract";
import { SKIP } from "./helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const open: PostgresPersistence[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((persistence) => persistence.close()));
});

async function database() {
  const pg = await fixture();
  await pg.reset();
  const persistence = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 4 } });
  open.push(persistence);
  const harness: Harness = {
    store: persistence.store,
    compose: (options: Partial<AppServicesOptions> = {}) =>
      createAppServices({ store: persistence.store, appOrigin: null, trustedProxyHops: 0, ...options }),
  };
  return { pg, persistence, harness };
}

catalogAndHintsContract("PostgreSQL", async () => (await database()).harness, SKIP);

type Pg = Awaited<ReturnType<typeof fixture>>;

/** Every row of every learner-session table, as text, one entry per table. */
const tables = async (pg: Pg, options: { withoutLearnerActivity?: boolean } = {}): Promise<Record<string, string>> => {
  // A learner's own sliding idle expiry moves whenever an authenticated request arrives (a replay is one), by design. These
  // four columns are that bookkeeping; every other column of the learner row, and every session and attempt row, must not.
  const row = (table: string) =>
    options.withoutLearnerActivity && table === "learners"
      ? "(to_jsonb(x) - 'revision' - 'updated_at' - 'idle_expires_at' - 'last_touched_at')"
      : "(to_jsonb(x))";
  const dump = (table: string) => `SELECT '${table}' AS t, coalesce(string_agg(${row(table)}::text, E'\\n' ORDER BY ${row(table)}::text), '') AS dump FROM ${table} x`;
  const { rows } = await pg.query<{ t: string; dump: string }>(
    [dump("learners"), dump("challenge_sessions"), dump("diagnosis_attempts")].join(" UNION ALL "),
  );
  return Object.fromEntries(rows.map((row) => [row.t, row.dump]));
};
const everything = async (pg: Pg) => Object.values(await tables(pg)).join("\n");

describe("PostgreSQL: what the database holds for the whole catalog", { skip: SKIP }, () => {
  test("every challenge's id and content version are stored exactly as the registry gives them", async () => {
    const { pg, harness } = await database();
    const services = harness.compose();
    for (const c of allCases()) {
      const cookie = (await services.service.startLearner(undefined)).cookie.value;
      assert.equal((await services.service.startChallenge(cookie, c.id)).status, "ok");
    }
    const { rows } = await pg.query<{ challenge_id: string; challenge_version: string }>(
      "SELECT challenge_id, challenge_version FROM challenge_sessions ORDER BY challenge_id",
    );
    assert.equal(rows.length, allCases().length);
    for (const row of rows) assert.equal(row.challenge_version, services.challengeVersion(row.challenge_id), row.challenge_id);
    assert.deepEqual(rows.map((row) => row.challenge_id), [...publishedChallengeIds()].sort());
  });

  test("a refusal for an unpublished challenge, and a replay, change no row, for every challenge", async () => {
    const { pg, harness } = await database();
    const services = harness.compose();
    const cookie = (await services.service.startLearner(undefined)).cookie.value;
    const cases = allCases();
    for (const [index, c] of cases.entries()) {
      await services.service.startChallenge(cookie, c.id);
      await services.service.submitDiagnosis(
        cookie,
        c.id,
        { rootCauseId: c.wrong[0], explanation: "The evidence I collected points to this cause: the logs show it.", evidence: [c.networkEvidence] },
        { submissionId: `0a0b0c0d-3333-4000-8000-${String(index).padStart(12, "0")}` },
      );
    }
    const snapshot = await tables(pg);
    const quiet = await tables(pg, { withoutLearnerActivity: true });

    // Refusals while everything is unpublished.
    const closed = harness.compose({ publishedChallengeIds: new Set() });
    for (const c of cases) {
      await closed.service.startChallenge(cookie, c.id);
      await closed.service.getChallengeSession(cookie, c.id);
      await closed.service.listAttempts(cookie, c.id);
      await closed.service.submitDiagnosis(cookie, c.id, { rootCauseId: c.correct, explanation: "x".repeat(40), evidence: [c.networkEvidence] });
    }
    assert.deepEqual(await tables(pg), snapshot, "refusals changed a row");

    // Replays of every earlier submission, once republished.
    for (const [index, c] of cases.entries()) {
      const replay = await services.service.submitDiagnosis(
        cookie,
        c.id,
        { rootCauseId: c.wrong[0], explanation: "The evidence I collected points to this cause: the logs show it.", evidence: [c.networkEvidence] },
        { submissionId: `0a0b0c0d-3333-4000-8000-${String(index).padStart(12, "0")}` },
      );
      assert.ok(replay.status === "ok" && replay.replayed, c.id);
    }
    // A replay records nothing: no session or attempt row changes, and the learner row changes only in its activity columns.
    const after = await tables(pg, { withoutLearnerActivity: true });
    for (const table of Object.keys(quiet)) {
      if (after[table] !== quiet[table]) {
        const was = new Set(quiet[table].split("\n"));
        const changed = after[table].split("\n").filter((line) => !was.has(line));
        assert.fail(`replays changed ${table}: ${changed.length} row(s), e.g. ${changed[0]?.slice(0, 600)}`);
      }
    }
    const attemptsNow = (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM diagnosis_attempts")).rows[0].n;
    assert.equal(attemptsNow, cases.length, "one attempt per challenge, however many times it was replayed");
  });

  test("investigation hints are never written to the database, and neither is any wrong-answer feedback (only a completed session's own result is stored)", async () => {
    const { pg, harness } = await database();
    const services = harness.compose({ attemptWindow: { limit: 1000, windowMs: 600_000 } });
    for (const c of allCases()) {
      const cookie = (await services.service.startLearner(undefined)).cookie.value;
      await services.service.startChallenge(cookie, c.id);
      for (const option of c.wrong) {
        await services.service.submitDiagnosis(cookie, c.id, { rootCauseId: option, explanation: "The evidence I collected points to this cause: the logs show it.", evidence: [c.logEvidence] });
      }
      // And the correct one, so a stored result exists (it is the one place a result is stored).
      await services.service.submitDiagnosis(cookie, c.id, { rootCauseId: c.correct, explanation: "The evidence I collected points to this cause: the logs show it.", evidence: [...c.evidence] });
    }
    const dump = await everything(pg);
    for (const challenge of AUTHORED_CHALLENGES) {
      for (const hint of challenge.investigationHints) assert.ok(!dump.includes(hint), `a hint is stored: ${hint.slice(0, 50)}`);
    }
    assert.ok(!dump.includes("Trace one failing request end to end"), "the generic hint is not stored either");
    assert.ok(!dump.includes("doesn't match what the evidence shows"), "no incorrect-feedback headline is stored");
  });
});

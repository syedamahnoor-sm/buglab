/*
 * The linking boundary end to end against real PostgreSQL: the boundary, the real provider-shaped verification, the real
 * store and the real session service together. INACTIVE code, exercised directly; no route exists.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createAppServices } from "@/server/app-services";
import { createPostgresPersistence, type PostgresPersistence } from "@/server/db/persistence";
import { PostgresAccountLinkStore } from "@/server/db/postgres-account-links";
import { createLearnerLinking } from "@/server/identity/link-boundary";
import { LEARNER_COOKIE } from "@/server/session/cookie";
import { SKIP } from "./helpers";
import { requestAs, testProvider } from "./identity-helpers";
import { pgFixture } from "./pg-fixture";

const fixture = pgFixture();
const open: PostgresPersistence[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((p) => p.close()));
});

async function setup() {
  const pg = await fixture();
  await pg.reset();
  const persistence = createPostgresPersistence({ config: { connectionString: pg.db.url, poolMax: 5 } });
  open.push(persistence);
  const services = createAppServices({ store: persistence.store, appOrigin: null });
  const linking = createLearnerLinking({ auth: testProvider(), accounts: new PostgresAccountLinkStore({ pool: persistence.pool }) });
  return { pg, persistence, services, linking };
}

describe("the linking boundary on PostgreSQL", { skip: SKIP }, () => {
  test("a signed-in account attaches this browser's learner with consent, and a second device resolves the same progress with no cookie", async () => {
    const { services, linking, persistence } = await setup();
    const { cookie } = await services.service.startLearner(undefined);
    await services.service.startChallenge(cookie.value, "challenge-001");
    const browser = { cookie: `${LEARNER_COOKIE}=${cookie.value}` };

    assert.deepEqual(await linking.linkBrowserLearner(requestAs("alice", browser), { consent: false }), { status: "consent-required" });
    assert.deepEqual(await linking.linkBrowserLearner(requestAs("alice", browser), { consent: true }), { status: "linked", retiredAnonymousCredential: true });
    assert.deepEqual(await linking.linkBrowserLearner(requestAs("alice", browser), { consent: true }), { status: "already-linked" });

    // Another device: signed in, no anonymous cookie at all.
    const resolved = await linking.resolveLearner(requestAs("alice"));
    assert.ok(resolved.status === "ok");
    assert.ok(await persistence.store.find({ learnerId: resolved.learnerId, challengeId: "challenge-001" }), "the same session, found without a token");
  });

  test("another account cannot take a learner that is claimed, and cannot reach its progress", async () => {
    const { services, linking } = await setup();
    const { cookie } = await services.service.startLearner(undefined);
    const browser = { cookie: `${LEARNER_COOKIE}=${cookie.value}` };
    await linking.linkBrowserLearner(requestAs("alice", browser), { consent: true });

    // Alice's link retired the credential, so the same cookie is now nothing: there is nothing left to claim, not even to be refused.
    assert.deepEqual(await linking.linkBrowserLearner(requestAs("mallory", browser), { consent: true }), { status: "no-browser-learner" });
    assert.deepEqual(await linking.resolveLearner(requestAs("mallory")), { status: "no-learner" }, "and mallory has no learner of her own, so nothing was handed over");
  });

  test("a stolen or guessed cookie links nothing, and signing in without the cookie links nothing", async () => {
    const { linking } = await setup();
    const guessed = { cookie: `${LEARNER_COOKIE}=${"A".repeat(43)}` };
    assert.deepEqual(await linking.linkBrowserLearner(requestAs("alice", guessed), { consent: true }), { status: "no-browser-learner" });
    assert.deepEqual(await linking.linkBrowserLearner(requestAs("alice"), { consent: true }), { status: "no-browser-learner" });
    assert.deepEqual(await linking.resolveLearner(requestAs("alice")), { status: "no-learner" });
  });

  test("nobody signed in cannot link, resolve or create, whatever cookie they hold", async () => {
    const { services, linking, pg } = await setup();
    const { cookie } = await services.service.startLearner(undefined);
    const holder = requestAs(null, { cookie: `${LEARNER_COOKIE}=${cookie.value}` });

    assert.deepEqual(await linking.linkBrowserLearner(holder, { consent: true }), { status: "unauthenticated" });
    assert.deepEqual(await linking.ensureLearner(holder), { status: "unauthenticated" });
    assert.deepEqual(await linking.resolveLearner(holder), { status: "unauthenticated" });
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM account_learner_links")).rows[0].n, 0);
  });

  test("an account with no browser learner gets its own authenticated-only learner, through the boundary", async () => {
    const { linking, pg } = await setup();
    assert.deepEqual(await linking.ensureLearner(requestAs("carol")), { status: "ok", created: true });
    assert.deepEqual(await linking.ensureLearner(requestAs("carol")), { status: "ok", created: false });
    const row = (await pg.query("SELECT token_hash FROM learners")).rows;
    assert.deepEqual(row, [{ token_hash: null }]);
  });
});

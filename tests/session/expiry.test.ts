import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cookieMaxAgeSeconds,
  createExpiryPolicy,
  DEFAULT_EXPIRY_POLICY,
  expiryState,
  initialTimes,
  isPurgeable,
  refreshedIdleExpiry,
  shouldRefresh,
  type SessionTimes,
} from "@/server/session/expiry";

const DAY = 86_400_000;
const policy = DEFAULT_EXPIRY_POLICY;
const T0 = Date.parse("2026-11-01T10:00:00Z");

/** A session as the store would hold it after creation, refreshed by writes at the given offsets. */
function sessionAfterWritesAt(...daysOfWrites: number[]): SessionTimes {
  let times: SessionTimes = initialTimes(policy, T0);
  for (const days of daysOfWrites) {
    const now = T0 + days * DAY;
    times = {
      ...times,
      lastTouchedAt: now,
      idleExpiresAt: refreshedIdleExpiry(policy, times, now),
    };
  }
  return times;
}

describe("DEFAULT_EXPIRY_POLICY", () => {
  test("uses the provisional values from the architecture proposal", () => {
    assert.deepEqual(policy, {
      idleTtlMs: 30 * DAY,
      absoluteTtlMs: 90 * DAY,
      touchIntervalMs: 1 * DAY,
      purgeGraceMs: 7 * DAY,
    });
  });

  test("is frozen, so no caller can change the shared defaults", () => {
    assert.equal(Object.isFrozen(DEFAULT_EXPIRY_POLICY), true);
    assert.throws(() => {
      (DEFAULT_EXPIRY_POLICY as { idleTtlMs: number }).idleTtlMs = 1;
    }, TypeError);
  });
});

describe("createExpiryPolicy", () => {
  test("returns the defaults when nothing is overridden, and applies overrides", () => {
    assert.deepEqual(createExpiryPolicy(), DEFAULT_EXPIRY_POLICY);
    assert.deepEqual(createExpiryPolicy({ idleTtlMs: 10 * DAY }), { ...DEFAULT_EXPIRY_POLICY, idleTtlMs: 10 * DAY });
    assert.equal(Object.isFrozen(createExpiryPolicy()), true);
  });

  test("rejects values that are not positive, finite numbers", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      assert.throws(() => createExpiryPolicy({ idleTtlMs: bad }), RangeError, `idle ${bad}`);
      assert.throws(() => createExpiryPolicy({ absoluteTtlMs: bad }), RangeError, `absolute ${bad}`);
      assert.throws(() => createExpiryPolicy({ touchIntervalMs: bad }), RangeError, `touch ${bad}`);
    }
  });

  test("allows a purge grace of zero but not a negative or non-finite one", () => {
    assert.doesNotThrow(() => createExpiryPolicy({ purgeGraceMs: 0 }));
    assert.throws(() => createExpiryPolicy({ purgeGraceMs: -1 }), RangeError);
    assert.throws(() => createExpiryPolicy({ purgeGraceMs: NaN }), RangeError);
  });

  test("rejects an idle limit longer than the absolute limit", () => {
    assert.throws(() => createExpiryPolicy({ idleTtlMs: 91 * DAY }), RangeError);
    assert.doesNotThrow(() => createExpiryPolicy({ idleTtlMs: 90 * DAY, touchIntervalMs: DAY }));
  });

  test("rejects a touch interval that is not shorter than the idle limit", () => {
    assert.throws(() => createExpiryPolicy({ touchIntervalMs: 30 * DAY }), RangeError);
    assert.throws(() => createExpiryPolicy({ touchIntervalMs: 31 * DAY }), RangeError);
  });
});

describe("initialTimes", () => {
  test("sets every time from creation: idle after the idle limit, absolute after the absolute limit", () => {
    assert.deepEqual(initialTimes(policy, T0), {
      createdAt: T0,
      lastTouchedAt: T0,
      idleExpiresAt: T0 + 30 * DAY,
      absoluteExpiresAt: T0 + 90 * DAY,
    });
  });

  test("never starts with an idle expiry beyond the absolute expiry", () => {
    const equal = createExpiryPolicy({ idleTtlMs: 5 * DAY, absoluteTtlMs: 5 * DAY, touchIntervalMs: DAY });

    const times = initialTimes(equal, T0);

    assert.equal(times.idleExpiresAt, times.absoluteExpiresAt);
  });
});

describe("expiryState", () => {
  const times = initialTimes(policy, T0);

  test("is active until the idle deadline, and expired from that instant", () => {
    assert.deepEqual(expiryState(times, T0), { state: "active" });
    assert.deepEqual(expiryState(times, times.idleExpiresAt - 1), { state: "active" });
    assert.deepEqual(expiryState(times, times.idleExpiresAt), { state: "expired", by: "idle" });
    assert.deepEqual(expiryState(times, times.idleExpiresAt + 1), { state: "expired", by: "idle" });
  });

  test("is expired by the absolute limit at its instant, even if the session was active a moment before", () => {
    const busy = sessionAfterWritesAt(80);

    assert.deepEqual(expiryState(busy, T0 + 90 * DAY - 1), { state: "active" });
    assert.deepEqual(expiryState(busy, T0 + 90 * DAY), { state: "expired", by: "absolute" });
  });

  test("reports absolute when both limits have passed", () => {
    assert.deepEqual(expiryState(times, T0 + 200 * DAY), { state: "expired", by: "absolute" });
  });

  test("an idle gap expires a session that is nowhere near its absolute limit", () => {
    const touched = sessionAfterWritesAt(20);

    assert.deepEqual(expiryState(touched, T0 + 50 * DAY - 1), { state: "active" });
    assert.deepEqual(expiryState(touched, T0 + 50 * DAY), { state: "expired", by: "idle" });
  });
});

describe("shouldRefresh", () => {
  const times = initialTimes(policy, T0);

  test("a write always refreshes, even straight after the last touch", () => {
    assert.equal(shouldRefresh(policy, times, T0, "write"), true);
    assert.equal(shouldRefresh(policy, times, T0 + 1, "write"), true);
  });

  test("a read refreshes only once the touch interval has passed", () => {
    assert.equal(shouldRefresh(policy, times, T0, "read"), false);
    assert.equal(shouldRefresh(policy, times, T0 + DAY - 1, "read"), false);
    assert.equal(shouldRefresh(policy, times, T0 + DAY, "read"), true);
    assert.equal(shouldRefresh(policy, times, T0 + 5 * DAY, "read"), true);
  });
});

describe("refreshedIdleExpiry", () => {
  test("is a full idle period from now", () => {
    const times = initialTimes(policy, T0);

    assert.equal(refreshedIdleExpiry(policy, times, T0 + 10 * DAY), T0 + 40 * DAY);
  });

  test("never goes past the absolute expiry, however late the activity", () => {
    const times = initialTimes(policy, T0);

    assert.equal(refreshedIdleExpiry(policy, times, T0 + 80 * DAY), T0 + 90 * DAY);
    assert.equal(refreshedIdleExpiry(policy, times, T0 + 89 * DAY), T0 + 90 * DAY);
  });

  test("does not change the absolute expiry: that is not an output of any refresh", () => {
    const before = initialTimes(policy, T0);
    const after = sessionAfterWritesAt(10, 40, 80);

    assert.equal(after.absoluteExpiresAt, before.absoluteExpiresAt);
  });
});

describe("worked example from the design (idle 30 days, absolute 90 days)", () => {
  test("day 0: idle expiry day 30, absolute expiry day 90", () => {
    const times = sessionAfterWritesAt();

    assert.equal(times.idleExpiresAt, T0 + 30 * DAY);
    assert.equal(times.absoluteExpiresAt, T0 + 90 * DAY);
  });

  test("day 20: a write moves the idle expiry to day 50", () => {
    assert.equal(sessionAfterWritesAt(20).idleExpiresAt, T0 + 50 * DAY);
  });

  test("day 80: a write would give day 110, so it is capped at day 90, and Max-Age is 10 days", () => {
    const times = sessionAfterWritesAt(20, 80);

    assert.equal(times.idleExpiresAt, T0 + 90 * DAY);
    assert.equal(cookieMaxAgeSeconds(times, T0 + 80 * DAY), 10 * 86_400);
  });

  test("day 91: expired even though the learner was active on day 80", () => {
    const times = sessionAfterWritesAt(20, 80);

    assert.deepEqual(expiryState(times, T0 + 91 * DAY), { state: "expired", by: "absolute" });
  });

  test("an idle gap from day 20 to day 51 also expires it", () => {
    const times = sessionAfterWritesAt(20);

    assert.deepEqual(expiryState(times, T0 + 51 * DAY), { state: "expired", by: "idle" });
  });
});

describe("isPurgeable", () => {
  const times = initialTimes(policy, T0);
  const expiredAt = times.idleExpiresAt;

  test("is false while the session is active and during the grace period", () => {
    assert.equal(isPurgeable(policy, times, T0), false);
    assert.equal(isPurgeable(policy, times, expiredAt), false);
    assert.equal(isPurgeable(policy, times, expiredAt + 7 * DAY - 1), false);
  });

  test("is true once the grace period has ended", () => {
    assert.equal(isPurgeable(policy, times, expiredAt + 7 * DAY), true);
    assert.equal(isPurgeable(policy, times, expiredAt + 8 * DAY), true);
  });

  test("counts the grace from whichever limit ends the session first", () => {
    const capped = sessionAfterWritesAt(80);

    assert.equal(isPurgeable(policy, capped, T0 + 90 * DAY + 7 * DAY - 1), false);
    assert.equal(isPurgeable(policy, capped, T0 + 90 * DAY + 7 * DAY), true);
  });

  test("with no grace period a session is purgeable the moment it expires", () => {
    const noGrace = createExpiryPolicy({ purgeGraceMs: 0 });

    assert.equal(isPurgeable(noGrace, times, expiredAt - 1), false);
    assert.equal(isPurgeable(noGrace, times, expiredAt), true);
  });
});

describe("cookieMaxAgeSeconds", () => {
  test("is the whole seconds left until the idle expiry", () => {
    const times = initialTimes(policy, T0);

    assert.equal(cookieMaxAgeSeconds(times, T0), 30 * 86_400);
    assert.equal(cookieMaxAgeSeconds(times, T0 + 1500), 30 * 86_400 - 2, "rounds down to whole seconds");
  });

  test("never exceeds the time left until the absolute expiry", () => {
    const times = sessionAfterWritesAt(85);

    assert.ok(cookieMaxAgeSeconds(times, T0 + 85 * DAY) <= 5 * 86_400);
  });

  test("is zero, never negative, once the session has expired", () => {
    const times = initialTimes(policy, T0);

    assert.equal(cookieMaxAgeSeconds(times, times.idleExpiresAt), 0);
    assert.equal(cookieMaxAgeSeconds(times, times.idleExpiresAt + 10 * DAY), 0);
  });
});

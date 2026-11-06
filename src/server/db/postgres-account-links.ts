/*
 * PostgreSQL implementation of the account-to-learner boundary (src/server/identity/types.ts). Server-only.
 *
 * INACTIVE and OPTIONAL: nothing mounts it; the only authentication provider that exists authenticates nobody; and the
 * core anonymous persistence path (migrations 0001 and 0002) does not construct or call this store. It requires migration
 * `0003_account_links` (proposed, pending joint review). See the types file for the model and the approved rules.
 *
 * WHAT THE DATABASE ENFORCES, not just this code: PRIMARY KEY (account_id) and UNIQUE (learner_id) on the link table, so
 * "one learner per account" and "one account per learner" hold however many instances race, and a racing claim has
 * exactly one winner. The check constraint on learners keeps an anonymous credential all-or-nothing.
 *
 * EVERY OPERATION starts by refusing an account that did not come from a verified authentication session
 * (assertVerifiedAccount), then by refusing when the account-link schema is absent (AccountLinksSchemaUnavailableError).
 *
 * POSSESSION. Linking requires the browser's LIVE anonymous credential: the cookie token's hash must find a learner that
 * is active at the database's clock. The learner row is locked FOR NO KEY UPDATE for the transaction, so a concurrent
 * core purge (which needs FOR UPDATE and skips what is locked) cannot delete it mid-link, and a learner that was purged
 * an instant earlier is simply not found. An expired credential, even inside the grace period, is not possession.
 *
 * LINKED-LEARNER RETENTION. Core `PostgresStore.purgeExpired` does not know about links. When this schema is applied and
 * linking is used, call `purgeExpiredExcludingLinked` (this module) instead of the core purge so claimed learners are
 * never deleted by expiry. Do not leave that to the foreign key alone.
 *
 * RACES. Contenders lock the learner row (`FOR NO KEY UPDATE`). The winner inserts the link and retires the anonymous
 * credential in the same transaction. Under READ COMMITTED the loser's waiting `WHERE token_hash = …` is re-checked when
 * the lock releases: the hash is gone, so the row is not found. A losing request for the *same* account then re-reads its
 * own link and answers `already-linked`. A losing request for a *different* account answers `no-browser-learner` — the
 * privacy-preserving generic miss, not `claimed-by-another-account`, and without disclosing who won. Unique-constraint
 * collisions (for example two `ensureAccountLearner` creates) re-run the transaction and never escape as a raw database
 * error. `claimed-by-another-account` is reserved for when the credential is still present and another account already
 * owns the learner.
 *
 * Time comes from the database clock (`now` in the options replaces it for tests only), as in PostgresStore.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { IdentityError, assertVerifiedAccount } from "@/server/identity/verified-account";
import type {
  AccountLearnerRecord,
  AccountLearnerStore,
  LinkBrowserLearnerInput,
  LinkOutcome,
  VerifiedAccount,
} from "@/server/identity/types";
import { createExpiryPolicy, expiryState, isPurgeable, type ExpiryPolicy } from "@/server/session/expiry";
import { assertTokenHash } from "@/server/session/store-rules";
import { LEARNER_COLUMNS, PURGE_BATCH, learnerOf, type LearnerRow } from "./postgres-store";
import { DB_NOW_MS_SQL, isUniqueViolation, toNumber, withTransaction, type Queryable } from "./sql";

/** Migration that creates `account_learner_links` and makes anonymous credentials optional. Not required by core persistence. */
export const ACCOUNT_LINKS_MIGRATION = "0003_account_links";

export class AccountLinksSchemaUnavailableError extends Error {
  constructor() {
    // Message text is a fixed literal (no interpolation): source guards forbid assembling SQL from variables;
    // keep the same discipline in user-facing errors that name migration versions.
    super(
      "Account linking is unavailable: migration 0003_account_links has not been applied. Core anonymous persistence does not require it.",
    );
    this.name = "AccountLinksSchemaUnavailableError";
  }
}

/** True when migration 0003 has been applied (the link table exists). Does not create anything. */
export async function accountLinksSchemaPresent(queryable: Queryable): Promise<boolean> {
  const { rows } = await queryable.query<{ present: boolean }>(
    "SELECT to_regclass('public.account_learner_links') IS NOT NULL AS present",
  );
  return rows[0].present;
}

/** Rejects unless migration 0003 is present. Safe to call from tests and from a future mount step. */
export async function verifyAccountLinksSchema(queryable: Queryable): Promise<void> {
  if (!(await accountLinksSchemaPresent(queryable))) throw new AccountLinksSchemaUnavailableError();
}

/**
 * Expiry purge that never deletes a learner an account has claimed. Requires migration 0003. Use this instead of
 * `PostgresStore.purgeExpired` once account linking is in use; the core store's purge intentionally has no link awareness.
 */
export async function purgeExpiredExcludingLinked(
  pool: pg.Pool,
  options: { policy?: Partial<ExpiryPolicy>; now?: () => number } = {},
): Promise<number> {
  await verifyAccountLinksSchema(pool);
  const policy = createExpiryPolicy(options.policy);
  const clock = options.now;
  const readNow = async (queryable: Queryable) => {
    if (clock) return clock();
    const { rows } = await queryable.query<{ now: string }>(`SELECT ${DB_NOW_MS_SQL} AS now`);
    return toNumber(rows[0].now);
  };

  let removed = 0;
  for (;;) {
    const now = await readNow(pool);
    const claimed = await withTransaction(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT l.id FROM learners l
          WHERE l.token_hash IS NOT NULL
            AND LEAST(l.idle_expires_at, l.absolute_expires_at) <= $1::bigint - $2::bigint
            AND NOT EXISTS (SELECT 1 FROM account_learner_links k WHERE k.learner_id = l.id)
          ORDER BY l.id
          LIMIT $3
            FOR UPDATE OF l SKIP LOCKED`,
        [now, policy.purgeGraceMs, PURGE_BATCH],
      );
      if (rows.length === 0) return { claimed: 0, deleted: 0 };
      const { rowCount } = await client.query(
        `DELETE FROM learners l
          WHERE l.id = ANY($1::text[])
            AND l.token_hash IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM account_learner_links k WHERE k.learner_id = l.id)`,
        [rows.map((row) => row.id)],
      );
      return { claimed: rows.length, deleted: rowCount ?? 0 };
    });
    removed += claimed.deleted;
    if (claimed.claimed < PURGE_BATCH) return removed;
  }
}

export interface PostgresAccountLinkStoreOptions {
  /** A pool built from the pooled runtime connection string. The caller owns it and closes it. */
  pool: pg.Pool;
  /** The anonymous-credential expiry rules, used to judge whether a presented credential is still live. Defaults to the central policy. */
  policy?: Partial<ExpiryPolicy>;
  /** TEST ONLY. Replaces the database clock, in milliseconds since the epoch. */
  now?: () => number;
  /** Source of internal ids. */
  newId?: () => string;
}

interface AccountLearnerRow {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  linked_at: string;
  has_credential: boolean;
}

const ACCOUNT_LEARNER_COLUMNS =
  "l.id, l.revision, l.created_at, l.updated_at, k.linked_at, (l.token_hash IS NOT NULL) AS has_credential";

const recordOf = (row: AccountLearnerRow): AccountLearnerRecord =>
  Object.freeze({
    id: row.id,
    revision: row.revision,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    linkedAt: toNumber(row.linked_at),
    hasAnonymousCredential: row.has_credential,
  });

/** How many times a transaction is re-run after losing a race on a unique constraint. Each re-run sees the winner. */
const MAX_RACE_RETRIES = 3;

export class PostgresAccountLinkStore implements AccountLearnerStore {
  private readonly pool: pg.Pool;
  private readonly policy: ExpiryPolicy;
  private readonly clock: (() => number) | undefined;
  private readonly newId: () => string;

  constructor({ pool, policy, now, newId = randomUUID }: PostgresAccountLinkStoreOptions) {
    this.pool = pool;
    this.policy = createExpiryPolicy(policy);
    this.clock = now;
    this.newId = newId;
  }

  private async now(queryable: Queryable): Promise<number> {
    if (this.clock) return this.clock();
    const { rows } = await queryable.query<{ now: string }>(`SELECT ${DB_NOW_MS_SQL} AS now`);
    return toNumber(rows[0].now);
  }

  private async requireSchema(queryable: Queryable = this.pool): Promise<void> {
    await verifyAccountLinksSchema(queryable);
  }

  /** Re-runs `work` when it loses a race on a unique constraint, so the loser reports what the winner did. */
  private async raced<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (attempt < MAX_RACE_RETRIES && isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  private async linkedLearner(queryable: Queryable, accountId: string): Promise<AccountLearnerRecord | null> {
    const { rows } = await queryable.query<AccountLearnerRow>(
      `SELECT ${ACCOUNT_LEARNER_COLUMNS}
         FROM account_learner_links k JOIN learners l ON l.id = k.learner_id
        WHERE k.account_id = $1`,
      [accountId],
    );
    return rows[0] ? recordOf(rows[0]) : null;
  }

  async findLearnerByAccount(account: VerifiedAccount): Promise<AccountLearnerRecord | null> {
    assertVerifiedAccount(account);
    await this.requireSchema();
    return this.linkedLearner(this.pool, account.accountId);
  }

  async ensureAccountLearner(account: VerifiedAccount): Promise<{ learner: AccountLearnerRecord; created: boolean }> {
    assertVerifiedAccount(account);
    await this.requireSchema();
    return this.raced(() =>
      withTransaction(this.pool, async (client) => {
        const existing = await this.linkedLearner(client, account.accountId);
        if (existing) return Object.freeze({ learner: existing, created: false });

        const now = await this.now(client);
        const id = this.newId();
        // An authenticated-only learner: no anonymous credential at all (the all-null block the check constraint allows).
        await client.query(
          `INSERT INTO learners (id, token_hash, revision, created_at, updated_at, last_touched_at, idle_expires_at, absolute_expires_at)
           VALUES ($1, NULL, 0, $2::bigint, $2::bigint, NULL, NULL, NULL)`,
          [id, now],
        );
        // A concurrent call for the same account loses HERE (unique account_id), the whole transaction rolls back, so
        // its learner row never persists, and the re-run finds the winner's.
        await client.query("INSERT INTO account_learner_links (account_id, learner_id, linked_at) VALUES ($1, $2, $3::bigint)", [
          account.accountId,
          id,
          now,
        ]);
        const created = await this.linkedLearner(client, account.accountId);
        return Object.freeze({ learner: created as AccountLearnerRecord, created: true });
      }),
    );
  }

  async linkBrowserLearner(account: VerifiedAccount, input: LinkBrowserLearnerInput): Promise<LinkOutcome> {
    assertVerifiedAccount(account);
    if (input.tokenHash !== null) assertTokenHash(input.tokenHash);
    await this.requireSchema();

    return this.raced(() =>
      withTransaction(this.pool, async (client): Promise<LinkOutcome> => {
        // 1. An account that already has a learner keeps it. Nothing merges, and possession is not even asked about.
        const existing = await this.linkedLearner(client, account.accountId);
        if (existing) return Object.freeze({ status: "already-linked", learner: existing } as const);

        // 2. Possession: the browser's live anonymous credential. Locked, so the purge cannot take it mid-link.
        if (input.tokenHash === null) return Object.freeze({ status: "no-browser-learner" } as const);
        const found = await client.query<LearnerRow>(
          `SELECT ${LEARNER_COLUMNS} FROM learners WHERE token_hash = $1 FOR NO KEY UPDATE`,
          [input.tokenHash],
        );
        if (!found.rows[0]) {
          // Not found after waiting usually means a concurrent link just retired this hash. If THAT was this account's own
          // other request, the link is already there — say so. If another account won, do not look up who: answer the same
          // generic miss as an unknown or expired cookie (`no-browser-learner`). Never restore the credential.
          const justLinked = await this.linkedLearner(client, account.accountId);
          if (justLinked) return Object.freeze({ status: "already-linked", learner: justLinked } as const);
          return Object.freeze({ status: "no-browser-learner" } as const);
        }
        const learner = learnerOf(found.rows[0]);
        const now = await this.now(client);
        if (isPurgeable(this.policy, learner, now) || expiryState(learner, now).state === "expired") {
          return Object.freeze({ status: "no-browser-learner" } as const);
        }

        // 3. A learner another account owns is never transferred. Reachable only while the credential is still present
        // (the usual concurrent race retires it first, so losers never get here). Under a race this very account may have
        // just claimed it after step 1 looked; that is "already linked", not a claim by somebody else.
        const claimed = await client.query<{ account_id: string }>("SELECT account_id FROM account_learner_links WHERE learner_id = $1", [learner.id]);
        if (claimed.rows[0]) {
          if (claimed.rows[0].account_id === account.accountId) {
            const mine = await this.linkedLearner(client, account.accountId);
            return Object.freeze({ status: "already-linked", learner: mine as AccountLearnerRecord } as const);
          }
          return Object.freeze({ status: "claimed-by-another-account" } as const);
        }

        // 4. Only with the learner's explicit consent. Anything but `true` is no.
        if (input.consent !== true) return Object.freeze({ status: "consent-required" } as const);

        // 5. THE CREDENTIAL TRANSITION, all inside this one transaction, in this order.
        //
        //    a. ESTABLISH authenticated access: the account now owns the learner.
        await client.query("INSERT INTO account_learner_links (account_id, learner_id, linked_at) VALUES ($1, $2, $3::bigint)", [
          account.accountId,
          learner.id,
          now,
        ]);
        //    b. PROVE it, by resolving the learner the way an authenticated request will (through the link, no token). Only
        //       if the account really reaches this learner may the anonymous way in be closed.
        const reachable = await this.linkedLearner(client, account.accountId);
        if (!reachable || reachable.id !== learner.id) {
          throw new IdentityError("link-failed", "Authenticated access to the learner could not be established.");
        }
        //    c. RETIRE the anonymous credential, but only the exact one that was presented: matching on the hash as well as
        //       the row means a credential that changed in the meantime is never retired by mistake. The credential is not
        //       replaced by a new one. There is no anonymous way back in: the learner is reachable only through the account.
        const retired = await client.query(
          `UPDATE learners
              SET token_hash = NULL, last_touched_at = NULL, idle_expires_at = NULL, absolute_expires_at = NULL,
                  updated_at = $3::bigint, revision = revision + 1
            WHERE id = $1 AND token_hash = $2`,
          [learner.id, input.tokenHash, now],
        );
        if (retired.rowCount !== 1) throw new IdentityError("link-failed", "The anonymous credential could not be retired.");
        //    d. VERIFY the end state before committing. Anything else rolls the link back with it.
        const linked = await this.linkedLearner(client, account.accountId);
        if (!linked || linked.id !== learner.id || linked.hasAnonymousCredential) {
          throw new IdentityError("link-failed", "The learner was not left reachable only through the account.");
        }
        return Object.freeze({ status: "linked", learner: linked } as const);
      }),
    );
  }
}

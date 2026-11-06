-- 0003: the storage boundary for the approved account-to-learner model. PROPOSED, PENDING JOINT REVIEW.
--
-- Nothing here implements authentication, sign-in, or linking endpoints, and nothing mounts. It only makes the schema
-- able to hold the approved model, so that the first real deployment does not need a data-moving migration later:
--
--   * one account maps to at most one learner, and one learner to at most one account (UNIQUE on both);
--   * a learner's ANONYMOUS CREDENTIAL (the cookie token hash and its idle and absolute expiry) is optional, so an
--     authenticated learner can exist with no anonymous credential, and is reached through its account link instead;
--   * the expiry purge must never delete a linked learner. The purge excludes linked learners explicitly (see
--     PostgresStore.purgeExpired). The foreign key below is only a last line of defence, never the mechanism.
--
-- See docs/architecture/account-learner-link-proposal.md for what is decided, what is proposed, and what needs review.
-- Applied by scripts/db-migrate.mjs inside one transaction. Do not edit once applied anywhere.

-- 1. The anonymous credential block becomes optional, all or nothing.
--    A learner either has a complete anonymous credential (hash plus all three times) or none of it.
ALTER TABLE learners ALTER COLUMN token_hash          DROP NOT NULL;
ALTER TABLE learners ALTER COLUMN last_touched_at     DROP NOT NULL;
ALTER TABLE learners ALTER COLUMN idle_expires_at     DROP NOT NULL;
ALTER TABLE learners ALTER COLUMN absolute_expires_at DROP NOT NULL;

ALTER TABLE learners ADD CONSTRAINT learners_credential_block_ck CHECK (
  (token_hash IS NULL
     AND last_touched_at IS NULL AND idle_expires_at IS NULL AND absolute_expires_at IS NULL)
  OR
  (token_hash IS NOT NULL
     AND last_touched_at IS NOT NULL AND idle_expires_at IS NOT NULL AND absolute_expires_at IS NOT NULL)
);
-- The existing UNIQUE and hex-format constraints on token_hash are unchanged. Several learners may have no hash:
-- NULLs are distinct, and a lookup by hash can never match one (a lookup is `token_hash = $1`, and the store refuses
-- any value that is not 64 lowercase hex characters).

-- 2. The link between an account and its one learner.
--    account_id is the authentication provider's own stable id, as text. It is deliberately NOT a foreign key into any
--    provider table (those do not exist yet and belong to the provider), and it is never supplied by a caller as proof of
--    anything: the store only accepts one that came from a verified authentication session.
CREATE TABLE account_learner_links (
  account_id TEXT   PRIMARY KEY CHECK (length(account_id) BETWEEN 1 AND 256),
  learner_id TEXT   NOT NULL UNIQUE REFERENCES learners (id) ON DELETE RESTRICT,
  linked_at  BIGINT NOT NULL
);
-- PRIMARY KEY (account_id) makes "one learner per account" a database fact.
-- UNIQUE (learner_id) makes "one account per learner" a database fact, and decides a racing claim: one wins.
-- ON DELETE RESTRICT is the backstop only. The purge never relies on it (a violation would abort a whole batch).

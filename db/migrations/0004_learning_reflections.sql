-- 0004: Learning Foundation Phase 1 - learner reflections.
--
-- Applied by scripts/db-migrate.mjs inside one transaction. Do not add a top-level BEGIN/COMMIT here, and never
-- edit this file once it has been applied anywhere: the runner records its checksum and refuses a changed file.
--
-- APPLY PATH. This migration depends only on 0001 (learners, challenge_sessions). It must NOT pull in the
-- optional account-linking migration 0003_account_links. The runner applies pending migrations in order, so a bare
-- `--through 0004_learning_reflections` WOULD also apply 0003. Apply the Learning Loop schema with the exclude option:
--
--   npm run db:migrate -- --through 0004_learning_reflections --exclude 0003_account_links
--
-- (library form: migrate({ through: "0004_learning_reflections", exclude: ["0003_account_links"] }); see
-- tests/postgres/learning-loop-migration.test.ts). 0003 stays pending and can be applied later, on its own approval.
--
-- Ownership integrity: the composite foreign key below guarantees a reflection's session belongs to the same
-- learner AND the same challenge. That the session is current and completed is checked by the service at
-- create time (design: docs/superpowers/specs/2026-11-05-learning-foundation-design.md, sections 3.1 and 5.2).
-- challenge_session_id is NOT NULL: there is no reflection without a session (contract section 10.2).
-- Completion immutability: a completed session can never be reopened or have its result changed (trigger below),
-- so "completed at create time" stays true for the life of the reflection.
-- Times are BIGINT milliseconds since the Unix epoch, as in 0001.

-- Target of the composite foreign key. (id) is already unique, so this adds no new restriction on sessions.
ALTER TABLE challenge_sessions
  ADD CONSTRAINT challenge_sessions_id_learner_challenge_uq
  UNIQUE (id, learner_id, challenge_id);

-- Once a session is completed, status, completed_at and result are frozen. (0001 already forbids superseding a
-- completed session; the application never rewrites these either. This is the database's own guard.)
CREATE FUNCTION reject_completed_session_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a completed challenge session cannot change status, completed_at or result'
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER challenge_sessions_completion_immutable
  BEFORE UPDATE ON challenge_sessions
  FOR EACH ROW
  WHEN (
    OLD.status = 'completed'
    AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
      OR NEW.result IS DISTINCT FROM OLD.result
    )
  )
  EXECUTE FUNCTION reject_completed_session_change();

CREATE TABLE learning_reflections (
  id                    TEXT    PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  learner_id            TEXT    NOT NULL REFERENCES learners (id) ON DELETE CASCADE,
  challenge_id          TEXT    NOT NULL CHECK (length(challenge_id) BETWEEN 1 AND 128),
  challenge_session_id  TEXT    NOT NULL,
  body                  TEXT    NOT NULL,
  revision              INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at            BIGINT  NOT NULL,
  updated_at            BIGINT  NOT NULL,
  deleted_at            BIGINT,
  completed_at          BIGINT  NOT NULL,
  CHECK (octet_length(body) BETWEEN 1 AND 16384),
  CHECK ((deleted_at IS NULL) OR (deleted_at >= created_at)),
  FOREIGN KEY (challenge_session_id, learner_id, challenge_id)
    REFERENCES challenge_sessions (id, learner_id, challenge_id)
);

-- At most one ACTIVE reflection per learner and challenge; a soft-deleted one frees the slot.
CREATE UNIQUE INDEX learning_reflections_active_uq
  ON learning_reflections (learner_id, challenge_id)
  WHERE deleted_at IS NULL;

CREATE INDEX learning_reflections_learner_updated_idx
  ON learning_reflections (learner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

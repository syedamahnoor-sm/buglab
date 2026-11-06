-- 0005: a short lease for a diagnosis submission that is being evaluated.
--
-- diagnosis_attempts cannot hold this. Its outcome is NOT NULL and limited to correct|incorrect,
-- its sequence number and the session counters describe a finished attempt, and list/window reads
-- must not see an in-flight submission. Editing 0001 is not allowed once it has been applied.
--
-- A row here is the processing state for one (session, submission id). It is inserted and committed
-- before evaluation, and deleted in the same transaction that inserts the finished attempt. There is
-- no status column: the row's presence is the claim, and expires_at is the recovery lease.
--
-- This is not part of the core 0001/0002 gate. reserve/finalize require this table; record() does not.
-- Depends only on challenge_sessions (0001).

CREATE TABLE diagnosis_submission_claims (
  session_id    TEXT   NOT NULL REFERENCES challenge_sessions (id) ON DELETE CASCADE,
  submission_id TEXT   NOT NULL CHECK (length(submission_id) BETWEEN 1 AND 128),
  request_hash  TEXT   NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  claim_token   TEXT   NOT NULL CHECK (length(claim_token) BETWEEN 1 AND 128),
  claimed_at    BIGINT NOT NULL,
  expires_at    BIGINT NOT NULL,
  PRIMARY KEY (session_id, submission_id),
  CHECK (expires_at > claimed_at)
);

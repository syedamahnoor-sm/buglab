-- 0002: shared fixed-window counters for distributed rate limiting.
--
-- One row per (scope, key). `scope` names what is limited (for example learner creation per
-- client address); `bucket_key` identifies who. Callers store an opaque digest, never a raw
-- address. A window runs from `window_started_at` to `expires_at`; the first hit after it ends
-- starts a new one in place. Rows whose window has ended are removed by the purge job and are
-- ignored by the limiter whether or not they have been removed yet.

CREATE TABLE rate_limit_buckets (
  scope             TEXT    NOT NULL CHECK (length(scope) BETWEEN 1 AND 128),
  bucket_key        TEXT    NOT NULL CHECK (length(bucket_key) BETWEEN 1 AND 256),
  window_started_at BIGINT  NOT NULL,
  hits              INTEGER NOT NULL CHECK (hits >= 1),
  expires_at        BIGINT  NOT NULL,
  PRIMARY KEY (scope, bucket_key),
  CHECK (expires_at > window_started_at)
);

CREATE INDEX rate_limit_buckets_expiry_idx ON rate_limit_buckets (expires_at);

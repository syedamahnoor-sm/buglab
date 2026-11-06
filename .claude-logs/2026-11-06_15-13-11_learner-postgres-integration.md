# Session log — BugLab learner backend Postgres integration

- Wired opt-in PostgreSQL via `src/server/learner-persistence.ts` + `learner-http` when `BUGLAB_DATABASE_URL` is set.
- Kept `app-services` MemoryStore-only (source-guard compliant).
- Documented migration 0003 vs Better Auth compatibility; linking remains disabled.
- Validation: unit 3138 pass, test:db 467 pass, test:auth 65 pass, lint/typecheck/build pass.

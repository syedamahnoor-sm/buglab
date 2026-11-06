# Codex session logging for BugLab

Reference: the supplied **Agent Session Logs — Setup Guide** in Downloads.
All exported agent conversations live in `.claude-logs/`. Existing Claude logs,
`~/.claude/settings.json`, and `~/.claude/extract-log.py` are preserved.

## Operation and activation

Verified on Windows with `codex-cli 0.167.0` and Python 3.12.
The installed CLI reports hooks as stable/enabled and discovers the project's
native `UserPromptSubmit` and `Stop` hooks without errors. Configuration lives
in `.codex/hooks.json`; `.codex/config.toml` activates this project layer.
Start from this checkout's root:

```powershell
codex -C 'C:\Users\Laptop Zone by JK\buglab'
```

Both hooks synchronously run `python scripts/codex_session_log.py`, passing
Codex JSON on stdin. Python must be on PATH. The prompt hook captures submitted
text; Stop captures the final response. Hook payloads bridge transcript flush
latency; subsequent reconciliation uses the original native timestamps.
Only `{}` is printed back to Codex, never the conversation text.

Both hook definitions were reviewed through Codex's native UI and are trusted.
The user `~/.codex/config.toml` contains two added `[hooks.state]` records; all
previous settings retain their original values. Trust is local, not committed.
New installations or changed hook definitions require review through `/hooks`.
No persistent trust bypass is configured.

## Export format and preservation

Each session owns one UTF-8 Markdown file:

```text
.claude-logs/<session-start-timestamp>_<codex-session-id>.md
```

The guide's `[CLAUDE_LOG_ENTRY type=PROMPT ...]` and `type=RESPONSE` markers,
frontmatter, attribution, statistics, and paste indicators are retained.
A Codex heading and `agent: "codex"` identify the agent. Name/email come from
Git; GitHub login uses the guide's environment override / `gh api user`, falling
back to `unknown` when unavailable. No attribution tools were installed.

Only actual completed user items and assistant `final_answer` items are
selected. Tool activity/results, commentary, reasoning, injected instructions,
subagents, and attachment bytes are excluded. Original message whitespace,
order, and timestamps are retained, except for explicit credential redactions.
Repeated item IDs are deduplicated; genuine repeated prompts remain separate.
As in the guide, the last final response in a turn wins. Interrupted prompts
can remain without an invented response.

Session ID, workspace, ownership, and symlink/collision checks protect existing
logs. An accepted conversation cannot be replaced by shorter or incompatible
history. A per-session OS lock serializes hook/follower/recovery writers; its
opaque lock file lives in OS temp and contains no conversation data. Atomic
replacement has bounded Windows sharing-violation retries. Re-exporting an
identical conversation leaves the log byte-for-byte unchanged.

## Recovery and the currently open session

Already-open Codex sessions may not reload hooks installed mid-session.
Recover a known native rollout without guessing the latest session:

```powershell
python scripts/codex_session_log.py --transcript 'FULL_PATH_TO_ROLLOUT.jsonl'
```

To cover an already-open session across multiple turns:

```powershell
python scripts/codex_session_log.py --follow-transcript 'FULL_PATH_TO_ROLLOUT.jsonl'
```

The corrected follower polls every second. It compares file identity, size,
modification time, and a SHA-256 content digest. It detects growth with frozen
Windows modification times and same-size rewrites. It reads a consistent byte
snapshot, defers an unfinished JSON/UTF-8 tail, and retries temporary missing or
locked files. Truncation cannot erase the last good export. A same-session
replacement must retain all accepted conversation history; a different-session
replacement is refused. A persistent unavailable/incompatible snapshot reports
an error on stderr after 30 seconds, preserving the old log.

The follower continues across turn completions and exits after **30 minutes
without source changes**. This is an explicit temporary bridge, not a permanent
service. The setup session has a hidden follower process running this mode.
Restart/resume Codex to load native hooks for normal ongoing use:

```powershell
codex -C 'C:\Users\Laptop Zone by JK\buglab' resume 01a1af27-7a4a-7670-b8f6-c5c40333f003
```

A force-kill, idle timeout, or follower failure requires restarting it or replaying
the transcript. Source session files stay in Codex's private storage and are
never copied into Git.

## Root cause and remediation evidence (2026-11-06)

The original follower watched only `st_mtime_ns`. Windows left the native
transcript's modification time unchanged while its open writer appended data,
so the helper missed later records. It also stopped after one turn. The fix
uses size/identity/content detection and follows subsequent turns.

Recovered in original order, with exact native content and timestamps:

- Implementation response: `2026-11-06T05:09:08.082Z`
- Review prompt: `2026-11-06T05:09:49.636Z`
- Review response: `2026-11-06T05:13:02.956Z`
- Remediation prompt: `2026-11-06T05:14:01.310Z`

The open session's export matched all 12 existing native user/final records
(seven prompts and five finals) before this remediation response completed.
Its final response is pending until this turn finishes; the follower remains
running across that boundary and future prompts within its inactivity limit.

## Tests

```powershell
python -B scripts/test_codex_session_log.py
python -B scripts/verify_codex_logging.py
```

Thirteen offline checks passed: frozen-mtime growth, same-size rewrite detection,
partial JSON/UTF-8, truncation/replacement protection, session identity, original
whitespace/embedded markers, duplicate prevention, secret filtering, Windows
sharing retries, per-session locking, and two-turn fixture operation of the
unchanged original Claude extractor. Fixtures stay in temporary directories.

Real session `01a1af4b-91b9-7332-b1e4-4036ba91a40f` passed two normal-trust hook
interactions. The observer saw each prompt exported before a final response,
then checked exact native/export message text, order, and timestamps after
completion. Repeated extraction produced identical bytes and one session file.
Two further real interactions in the same session exercised the follower only,
with hooks disabled **for those test invocations**, leaving settings unchanged.
Both follower-only turns passed the same submission/completion/equality checks.

An earlier observer hit a transient NTFS sharing conflict. The final code retries
both exported-log reads and atomic replacement; that verification attempt's
conversation is retained as assessment evidence. Historical controlled hook
verification used a one-invocation trust bypass; the current verifier and normal
launch commands contain no trust bypass.

The verifier makes real model requests and retains sanitized conversation logs.
No application code or backend code is exercised or modified by these tests.

## Secrets, commit policy, and limits

Both prompts and finals are filtered for common API keys, GitHub tokens, AWS
access-key IDs, bearer tokens, named secret/password assignments, private-key
blocks, and URL passwords. Statistics describe sanitized text. Test credentials
are synthetic. Filtering cannot identify every secret or personal detail: review
exports before staging. The guide intentionally retains author name/email and
local paths. Attribution may remain `unknown` without an available GitHub CLI.

Commit reviewed conversation files with the logging implementation, including
verification conversations as assessment evidence. Exclude raw native rollouts,
credentials, environment files, user-level Codex configuration/trust state,
OS-temp lock files, and caches. Preserve the pre-existing modified Claude log
without including its unrelated changes. Nothing is automatically staged or
committed.

The parser targets the observed 0.167.0 completed-item JSONL format. CLI upgrades
or database-backed history migration require revalidation. Hooks here apply to
local sessions launched from this checkout root; other worktrees were untouched.
Cloud orchestration has different support. The temporary follower requires a
live process; use native hooks in restarted/resumed sessions for ongoing logging.

Official references: [Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[non-interactive events](https://learn.chatgpt.com/docs/non-interactive-mode).

## Final remediation review

All seven Codex-owned conversation files passed secret-pattern review and an
independent comparison of user/final text, sequence, and native timestamps.
The interrupted observer test was also reconciled from its native transcript,
including its eventual final response. The original six Claude log hashes and
Claude settings/extractor hashes still match the pre-implementation baseline.
Existing Codex setting values, branch, HEAD, two stashes, and two worktrees were
preserved. The sole pre-existing modified Claude log remains outside the
proposed commit. No cache or temporary export artifacts appear in Git status.

Only the logging implementation, documentation/policy, and seven Codex evidence
files are proposed for review. Nothing has been staged or committed. The open
session's remediation final response cannot be compared until it has finished;
the verified running follower will reconcile it afterward.

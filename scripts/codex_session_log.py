#!/usr/bin/env python3
"""Export Codex conversation text in the hackathon's Claude-log format.

No third-party dependencies. Hook input is read from stdin; --transcript also
allows recovery of an existing native rollout. Never copies raw transcripts.
"""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.dont_write_bytecode = True

from session_log_format import (calculate_session_stats, detect_paste_indicators,
                                format_timestamp, get_git_author, get_git_email,
                                get_github_user)

ROOT = Path(__file__).resolve().parent.parent


def redact(text):
    """Conservative common-secret filtering; manual review remains necessary."""
    text = re.sub(r"-----BEGIN ([A-Z ]*PRIVATE KEY)-----.*?-----END \1-----",
                  "[REDACTED PRIVATE KEY]", text, flags=re.S)
    text = re.sub(r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|"
                  r"github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b",
                  "[REDACTED CREDENTIAL]", text)
    text = re.sub(r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/-]{8,}=*",
                  r"\1[REDACTED]", text)
    text = re.sub(r'''(?im)((?:["']?\b(?:[A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD)|authorization)["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;"'`<>]+)''',
                  r"\1[REDACTED]", text)
    text = re.sub(r"(\b[a-z][a-z0-9+.-]*://[^\s/:@]+:)[^\s/@]+(@)",
                  r"\1[REDACTED]\2", text, flags=re.I)
    return text


class IncompleteSnapshot(ValueError):
    """A live transcript is temporarily incomplete; preserve the last export."""


def read_snapshot(path):
    # Windows can defer LastWriteTime updates while Codex holds a writer open.
    # Hash bytes as well as checking size/identity, including same-size rewrites.
    for _ in range(3):
        with path.open("rb") as handle:
            before = os.fstat(handle.fileno())
            data = handle.read()
            after = os.fstat(handle.fileno())
        current = path.stat()
        if (before.st_size == after.st_size == len(data)
                and before.st_mtime_ns == after.st_mtime_ns
                and (after.st_dev, after.st_ino) == (current.st_dev, current.st_ino)):
            key = (after.st_dev, after.st_ino, len(data), after.st_mtime_ns,
                   hashlib.sha256(data).digest())
            return data, key
        time.sleep(0.02)
    raise IncompleteSnapshot("Transcript changed while reading")


def parse_rollout(data):
    rows = []
    lines = data.splitlines(keepends=True)
    for number, line in enumerate(lines):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line.decode("utf-8")))
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Only an unterminated final record may be a partial write, including
            # a UTF-8 codepoint split across writes. Invalid complete rows fail.
            if number != len(lines) - 1 or line.endswith(b"\n"):
                raise ValueError("Malformed transcript record; export refused")
    return rows


def read_rollout(path):
    return parse_rollout(read_snapshot(path)[0])


def read_export(path):
    # NTFS can briefly deny opens while another process replaces the log.
    for attempt in range(20):
        try:
            return path.read_text(encoding="utf-8")
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def replace_export(temporary, target):
    # Readers may briefly hold a Windows handle without delete sharing.
    for attempt in range(20):
        try:
            temporary.replace(target)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def conversation_from_log(text):
    """Read our length-delimited entries, even when message text has markers."""
    entries, position = [], 0
    marker = re.compile(r"^\[CLAUDE_LOG_ENTRY type=(PROMPT|RESPONSE) num=\d+ session=[a-zA-Z0-9-]+\]\n", re.M)
    while match := marker.search(text, position):
        metadata_end = text.index("\n\n", match.end())
        metadata = dict(line.split(": ", 1) for line in text[match.end():metadata_end].splitlines())
        start = metadata_end + 2
        end = start + int(metadata["chars"])
        if end > len(text):
            raise ValueError("Incomplete exported log; refusing replacement")
        entries.append(dict(role="user" if match[1] == "PROMPT" else "assistant",
                            timestamp=metadata["timestamp"], text=text[start:end]))
        position = end
    return entries


def conversation(entries):
    return [(e["role"], e["timestamp"], e["text"]) for e in entries]


def require_history_prefix(previous, candidate):
    # Hook fallback timestamps are provisional until the native item is flushed.
    old = [(e["role"], e["text"]) for e in previous]
    new = [(e["role"], e["text"]) for e in candidate]
    if new[:len(old)] != old:
        raise IncompleteSnapshot("Transcript history shortened or changed; preserving the existing log")


def text_content(content):
    if isinstance(content, str):
        return content
    return "\n\n".join(b.get("text", "") for b in content or []
                        if b.get("type", "").lower() in ("text", "input_text", "output_text"))


def extract(rows):
    """Use completed UI items, not raw model inputs containing injected text."""
    entries, seen = [], set()
    for row in rows:
        payload = row.get("payload", {})
        if row.get("type") != "event_msg" or payload.get("type") != "item_completed":
            continue
        item = payload.get("item", {})
        kind = item.get("type")
        role = "user" if kind == "UserMessage" else "assistant"
        if kind != "UserMessage" and not (kind == "AgentMessage" and item.get("phase") == "final_answer"):
            continue
        key = item.get("id")
        if not key or key in seen:
            continue
        seen.add(key)
        text = text_content(item.get("content"))
        if text.strip():
            entries.append({"timestamp": row.get("timestamp", ""), "role": role,
                            "text": redact(text), "turn": payload.get("turn_id"), "id": key})
    # Retain only the last final response in a turn, as in the supplied guide.
    result = []
    for entry in entries:
        if (entry["role"] == "assistant" and result and result[-1]["role"] == "assistant"
                and result[-1]["turn"] == entry["turn"]):
            result[-1] = entry
        else:
            result.append(entry)
    return result


def render(entries, session_id, started, cwd):
    date = started[:10]
    author, email, github = get_git_author(), get_git_email(), get_github_user()
    triples = [(e["timestamp"], e["role"], e["text"]) for e in entries]
    fields = dict(session_id=session_id, date=date, author=author, github_user=github,
                  git_email=email, project=cwd.name, agent="codex",
                  session_status="complete" if entries[-1]["role"] == "assistant" else "awaiting_response",
                  last_entry_type=entries[-1]["role"],
                  total_exchanges=sum(e["role"] == "user" for e in entries),
                  generated_at=datetime.now(timezone.utc).isoformat())
    fields.update(calculate_session_stats(triples))
    lines = ["---"] + [f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in fields.items()]
    lines += ["---\n", f"# Codex Session Log - {date}\n",
              f"Session: `{session_id}` | Project: `{cwd.name}` | Author: `{author}` | GitHub: `{github}`\n", "---\n"]
    num = 0
    for entry in entries:
        text, timestamp = entry["text"], entry["timestamp"]
        if entry["role"] == "user":
            num += 1
            kind = "PROMPT"
        else:
            kind = "RESPONSE"
        lines += [f"\n[CLAUDE_LOG_ENTRY type={kind} num={num} session={session_id}]",
                  f"timestamp: {timestamp}", f"time: {format_timestamp(timestamp)}", f"chars: {len(text)}"]
        if kind == "PROMPT":
            indicators = detect_paste_indicators(text)
            lines += [f"words: {len(text.split())}"]
            lines += [f"{k}: {indicators[k]}" for k in
                      ("has_code_block", "has_file_paths", "has_urls", "likely_pasted")]
        lines += [f"\n{text}\n"]
    return "\n".join(lines)


@contextmanager
def session_lock(root, session_id, timeout=5):
    # Serialize hook/follower/recovery writers for this one session. The lock
    # contains no conversation data and lives in OS temp, outside the repo.
    key = hashlib.sha256((str(root.resolve()) + "|" + session_id).encode()).hexdigest()
    path = Path(tempfile.gettempdir()) / ("buglab-codex-log-" + key + ".lock")
    with path.open("a+b") as handle:
        if handle.seek(0, 2) == 0:
            handle.write(b"0")
            handle.flush()
        deadline = time.monotonic() + timeout
        while True:
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Session log is busy")
                time.sleep(0.05)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def export(transcript, hook=None, root=ROOT, rows=None):
    rows = read_rollout(transcript) if rows is None else rows
    meta = next((r["payload"] for r in rows if r.get("type") == "session_meta"), {})
    identity = str(meta.get("id") or meta.get("session_id") or "missing")
    with session_lock(root, identity):
        return export_snapshot(transcript, hook, root, rows)


def export_snapshot(transcript, hook=None, root=ROOT, rows=None):
    hook = hook or {}
    rows = read_rollout(transcript) if rows is None else rows
    meta = next((r["payload"] for r in rows if r.get("type") == "session_meta"), None)
    if not meta:
        raise ValueError("No session metadata; unsupported transcript")
    cwd = Path(meta["cwd"]).resolve()
    if cwd != root.resolve():
        raise ValueError("Session belongs to another workspace")
    if isinstance(meta.get("source"), dict) or meta.get("thread_source") == "subagent":
        return None
    session_id = meta.get("id") or meta.get("session_id")
    if not re.fullmatch(r"[a-zA-Z0-9-]+", session_id or ""):
        raise ValueError("Unsafe session id")
    if hook.get("session_id") and hook["session_id"] != session_id:
        raise ValueError("Hook/transcript session mismatch")
    entries = extract(rows)
    # Prompt hooks fire before the new prompt has necessarily reached disk.
    # Rebuilds from the transcript on Stop, so this fallback cannot duplicate it.
    if hook.get("hook_event_name") == "UserPromptSubmit":
        turn = hook.get("turn_id")
        prompt = hook.get("prompt", "")
        if prompt and not any(e["role"] == "user" and e["turn"] == turn for e in entries):
            entries.append(dict(timestamp=datetime.now(timezone.utc).isoformat(), role="user",
                                text=redact(prompt), turn=turn, id="hook-prompt"))
    if hook.get("hook_event_name") == "Stop":
        turn = hook.get("turn_id")
        final = hook.get("last_assistant_message")
        if final and not any(e["role"] == "assistant" and e["turn"] == turn for e in entries):
            entries.append(dict(timestamp=datetime.now(timezone.utc).isoformat(), role="assistant",
                                text=redact(final), turn=turn, id="hook-final"))
    if not entries or not any(e["role"] == "user" for e in entries):
        raise ValueError("No completed user items; unsupported or not yet flushed transcript")
    started = meta.get("timestamp", rows[0].get("timestamp"))
    stamp = datetime.fromisoformat(started.replace("Z", "+00:00")).strftime("%Y-%m-%d_%H-%M-%S")
    directory = cwd / ".claude-logs"
    if directory.is_symlink():
        raise ValueError("Refusing symlink log directory")
    directory.mkdir(exist_ok=True)
    matches = list(directory.glob(f"*_{session_id}.md"))
    if len(matches) > 1:
        raise ValueError("Multiple session files; refusing to overwrite")
    target = matches[0] if matches else directory / f"{stamp}_{session_id}.md"
    if target.is_symlink():
        raise ValueError("Refusing symlink output")
    if target.exists():
        old = read_export(target)
        frontmatter = old.split("\n---\n", 1)[0].splitlines() if old.startswith("---\n") else []
        if f'session_id: "{session_id}"' not in frontmatter or 'agent: "codex"' not in frontmatter:
            raise ValueError("Existing file is not this extractor's Codex log")
        previous_entries = conversation_from_log(old)
        require_history_prefix(previous_entries, entries)
        if conversation(previous_entries) == conversation(entries):
            return target
    output = render(entries, session_id, started, cwd)
    # All writes occur beside the destination; no partially rendered log.
    temporary = target.with_suffix(f".{os.getpid()}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(output)
        replace_export(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


class TranscriptFollower:
    """Reconcile complete snapshots without ever replacing a log with a prefix."""
    def __init__(self, path, root=ROOT):
        self.path, self.root = path, root
        self.previous = None
        self.session_id = None

    def poll(self):
        data, key = read_snapshot(self.path)
        if key == self.previous:
            return False
        rows = parse_rollout(data)
        meta = next((r["payload"] for r in rows if r.get("type") == "session_meta"), {})
        identity = meta.get("id") or meta.get("session_id")
        if not identity:
            raise IncompleteSnapshot("Waiting for session metadata")
        if self.session_id is not None and identity != self.session_id:
            raise ValueError("Replacement transcript belongs to a different session")
        if not extract(rows):
            raise IncompleteSnapshot("Waiting for completed conversation items")
        export(self.path, root=self.root, rows=rows)
        self.session_id = identity
        self.previous = key
        return True


def follow_transcript(path, root=ROOT, idle_timeout=1800):
    follower = TranscriptFollower(path, root)
    deadline = time.monotonic() + idle_timeout
    waiting_since = None
    while time.monotonic() < deadline:
        try:
            if follower.poll():
                deadline = time.monotonic() + idle_timeout
            waiting_since = None
        except (IncompleteSnapshot, FileNotFoundError, PermissionError):
            # Replacement/truncation/partial flush: leave the previous log intact
            # and retry. A permanent failure becomes visible, never silent loss.
            waiting_since = waiting_since or time.monotonic()
            if time.monotonic() - waiting_since > 30:
                raise IncompleteSnapshot("Transcript unavailable/incompatible for over 30 seconds")
        time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transcript", type=Path)
    parser.add_argument("--follow-transcript", type=Path, help="Follow an already-open session across turns (30-minute inactivity timeout)")
    args = parser.parse_args()
    if args.follow_transcript:
        os.chdir(ROOT)
        follow_transcript(args.follow_transcript)
        return
    hook = {} if args.transcript else json.load(sys.stdin)
    if hook.get("cwd") and Path(hook["cwd"]).resolve() != ROOT:
        return
    path = args.transcript or (Path(hook["transcript_path"]) if hook.get("transcript_path") else None)
    if not path:
        raise ValueError("Codex provided no transcript; logging unavailable (no latest-session guessing)")
    previous = Path.cwd()
    try:
        os.chdir(ROOT)
        export(path, hook)
    finally:
        os.chdir(previous)
    if not args.transcript:
        print("{}")  # Stop hooks require JSON, never conversation text.


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Codex conversation logging failed ({type(error).__name__}); run the documented recovery command.", file=sys.stderr)
        sys.exit(1)

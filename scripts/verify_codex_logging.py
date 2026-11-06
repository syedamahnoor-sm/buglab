"""Two real Codex turns: submit-time capture and exact native/export equality."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time

sys.dont_write_bytecode = True
import codex_session_log as log

ROOT = Path(__file__).resolve().parent.parent
CODEX = shutil.which('codex.cmd') or shutil.which('codex')


def native_conversation(path):
    # Independent selection from the source events, including native timestamps.
    result, seen = [], set()
    for line in path.read_text(encoding='utf-8').splitlines():
        row = json.loads(line)
        if row.get('type') != 'event_msg':
            continue
        payload = row.get('payload', {})
        if payload.get('type') != 'item_completed':
            continue
        item = payload.get('item', {})
        kind = item.get('type')
        if kind == 'UserMessage':
            role = 'user'
        elif kind == 'AgentMessage' and item.get('phase') == 'final_answer':
            role = 'assistant'
        else:
            continue
        if item['id'] in seen:
            continue
        seen.add(item['id'])
        content = item.get('content', [])
        text = content if isinstance(content, str) else '\n\n'.join(b['text'] for b in content if b.get('type','').lower() in ('text','input_text','output_text'))
        if text.strip():
            result.append((role, row['timestamp'], log.redact(text)))
    return result


def run(args, prompt, turn_number, thread=None, follow_only=False):
    flags = ['--disable', 'hooks'] if follow_only else []
    command = [CODEX, '--no-daemon'] + flags + ['-a', 'never', 'exec'] + args + ['--json', prompt]
    p = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, encoding='utf-8')
    events, errors = [], []
    def consume():
        for line in p.stdout:
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    reader = threading.Thread(target=consume, daemon=True)
    reader.start()
    err_reader = threading.Thread(target=lambda: errors.extend(p.stderr.readlines()), daemon=True)
    err_reader.start()
    submitted = False
    follower = None
    deadline = time.monotonic() + 180
    try:
        while p.poll() is None:
            if time.monotonic() > deadline:
                raise TimeoutError('Live logging verification timed out')
            if not thread:
                thread = next((e['thread_id'] for e in events if e.get('type') == 'thread.started'), None)
            if thread:
                if follow_only:
                    paths = list((Path.home()/'.codex/sessions').rglob('*'+thread+'.jsonl'))
                    if paths:
                        follower = follower or log.TranscriptFollower(paths[0])
                        try:
                            follower.poll()
                        except (log.IncompleteSnapshot, FileNotFoundError, PermissionError):
                            pass
                files = list((ROOT/'.claude-logs').glob('*_'+thread+'.md'))
                if len(files) == 1:
                    entries = log.conversation_from_log(log.read_export(files[0]))
                    if (sum(e['role']=='user' for e in entries) == turn_number
                            and sum(e['role']=='assistant' for e in entries) == turn_number-1
                            and entries[-1]['text'] == log.redact(prompt)):
                        submitted = True
            time.sleep(0.02)
        reader.join(timeout=3)
        err_reader.join(timeout=3)
        assert p.returncode == 0, 'Codex failed: '+log.redact(''.join(errors)[-1000:])
        assert submitted, 'Prompt was not observed in the log before the final response'
        assert not any(e.get('type') == 'error' for e in events)
        files = list((ROOT/'.claude-logs').glob('*_'+thread+'.md'))
        assert len(files) == 1
        native = next((Path.home()/'.codex/sessions').rglob('*'+thread+'.jsonl'))
        if follow_only:
            follower.poll()
        expected = native_conversation(native)
        actual = log.conversation(log.conversation_from_log(log.read_export(files[0])))
        assert actual == expected, 'Export differs from native message content/order/timestamps'
        assert sum(e[0]=='user' for e in actual)==turn_number
        assert sum(e[0]=='assistant' for e in actual)==turn_number
        text=log.read_export(files[0])
        assert 'BUGLAB_SYNTHETIC_NOT_A_REAL_SECRET' not in text
        assert log.redact(text)==text
        print('PASS turn',turn_number,': prompt observed before final; native/export text, order and timestamps match.',flush=True)
        return thread, native, files[0]
    finally:
        if p.poll() is None:
            p.terminate()
        p.wait(timeout=10)


if __name__ == '__main__':
    thread, native, target = run(['--sandbox','read-only'],
        'Logging continuity verification interaction 1. API_KEY=BUGLAB_SYNTHETIC_NOT_A_REAL_SECRET. Do not call tools or change files. Reply exactly BUGLAB_CONTINUITY_ONE.',1)
    print('Session:',thread,flush=True)
    run(['resume',thread],
        'Logging continuity verification interaction 2. Do not call tools or change files. Reply exactly BUGLAB_CONTINUITY_TWO.',2,thread)
    before=target.read_bytes()
    log.export(native)
    log.export(native)
    assert target.read_bytes()==before, 'Repeated extraction is not byte-idempotent'
    assert len(list((ROOT/'.claude-logs').glob('*_'+thread+'.md')))==1
    print('PASS repeated extraction: no duplicates, identical bytes, one session file.',flush=True)
    print('Evidence:',target.relative_to(ROOT),flush=True)

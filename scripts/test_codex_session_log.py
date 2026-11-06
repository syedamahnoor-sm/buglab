"""Logging-only regression checks; all fixture logs stay in temporary folders."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codex_session_log as log

class LoggingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.path = self.root / 'rollout.jsonl'
        self.rows = [dict(type='session_meta', timestamp='2026-11-06T05:00:00Z', payload=dict(id='test-codex-session', cwd=str(self.root), timestamp='2026-11-06T05:00:00Z', source='cli'))]
        self.addCleanup(self.tmp.cleanup)
        for name in ('get_git_author','get_git_email','get_github_user'):
            p = patch.object(log, name, return_value='test-author')
            p.start()
            self.addCleanup(p.stop)

    def item(self, kind, text, turn, identity, phase=None):
        item = dict(type=kind, id=identity, content=[dict(type='text', text=text)])
        if phase:
            item['phase'] = phase
        self.rows.append(dict(type='event_msg', timestamp=f'2026-11-06T05:0{turn}:00Z', payload=dict(type='item_completed', turn_id=str(turn), item=item)))

    def write(self):
        self.path.write_text('\n'.join(json.dumps(r) for r in self.rows)+'\n', encoding='utf-8')

    def export(self, hook=None):
        self.write()
        return log.export(self.path, hook, root=self.root)

    def test_two_interactions_hook_timing_duplicates_and_secrets(self):
        # Pre-persistence prompt fallback, then a normal completed first turn.
        first = self.export(dict(hook_event_name='UserPromptSubmit', turn_id='1', prompt='First interaction API_KEY=fixture-secret-one'))
        self.assertIn('awaiting_response', first.read_text())
        self.item('UserMessage', 'First interaction API_KEY=fixture-secret-one', 1, 'u1')
        self.item('AgentMessage', 'COMMENTARY_SECRET', 1, 'c1', 'commentary')
        self.rows.append(dict(type='response_item', payload=dict(type='message', role='user', content=[dict(type='input_text', text='INJECTED_SECRET')])) )
        self.rows.append(dict(type='response_item', payload=dict(type='custom_tool_call_output', output='TOOL_SECRET')))
        self.item('AgentMessage', 'First final PASSWORD=fixture-secret-two', 1, 'a1', 'final_answer')
        self.rows.append(self.rows[-1].copy())  # duplicate native event
        first = self.export(dict(hook_event_name='Stop', turn_id='1', last_assistant_message='First final PASSWORD=fixture-secret-two'))
        self.assertEqual(first.read_text().count('type=RESPONSE'), 1)
        self.item('UserMessage', 'Second interaction', 2, 'u2')
        second = self.export(dict(hook_event_name='UserPromptSubmit', turn_id='2', prompt='Second interaction'))
        self.assertEqual(first, second)
        self.assertIn('awaiting_response', second.read_text())
        # Stop fallback covers a final message not yet flushed to the transcript.
        self.export(dict(hook_event_name='Stop', turn_id='2', last_assistant_message='Second final'))
        self.item('AgentMessage', 'Second final', 2, 'a2', 'final_answer')
        second = self.export()
        self.export()
        text = second.read_text()
        self.assertEqual(len(list((self.root/'.claude-logs').glob('*.md'))), 1)
        self.assertEqual(text.count('type=PROMPT'), 2)
        self.assertEqual(text.count('type=RESPONSE'), 2)
        self.assertIn('total_exchanges: 2', text)
        self.assertIn('session_status: "complete"', text)
        for secret in ('fixture-secret-one','fixture-secret-two','COMMENTARY_SECRET','TOOL_SECRET','INJECTED_SECRET'):
            self.assertNotIn(secret, text)
        self.assertIn('[REDACTED]', text)

    def test_collision_workspace_and_incomplete_records(self):
        self.item('UserMessage', 'Hello', 1, 'u1')
        target = self.export()
        target.write_text('existing Claude content', encoding='utf-8')
        with self.assertRaises(ValueError):
            self.export()
        self.assertEqual(target.read_text(), 'existing Claude content')
        self.rows[0]['payload']['cwd'] = str(self.root/'different')
        with self.assertRaises(ValueError):
            self.export()
        self.rows[0]['payload']['cwd'] = str(self.root)
        self.write()
        with self.path.open('a') as f:
            f.write('{"unfinished":')
        self.assertEqual(len(log.read_rollout(self.path)), len(self.rows))

    def test_distinct_session_ids_never_share_output(self):
        self.item('UserMessage', 'First session', 1, 'u1')
        first = self.export()
        before = first.read_bytes()
        self.rows[0]['payload']['id'] = 'another-codex-session'
        second = self.export()
        self.assertNotEqual(first, second)
        self.assertEqual(first.read_bytes(), before)
        self.assertEqual(len(list((self.root/'.claude-logs').glob('*.md'))), 2)

    def test_credential_patterns(self):
        samples = ['TOKEN="fixture123"', 'PASSWORD="fixture words with spaces"', 'authorization: Bearer abcdefghijklmnop',
                   'https://user:fixturepass@example.com', 'sk-'+'x'*30,
                   '-----BEGIN PRIVATE KEY-----\nfixturekey\n-----END PRIVATE KEY-----']
        for sample in samples:
            clean = log.redact(sample)
            self.assertIn('[REDACTED', clean)
            for secret in ('fixture123','abcdefghijklmnop','fixturepass','x'*30,'fixturekey','fixture words with spaces'):
                self.assertNotIn(secret, clean)

    def test_follower_detects_growth_with_unchanged_mtime(self):
        self.item('UserMessage', 'Submitted prompt', 1, 'u1')
        self.write()
        fixed = self.path.stat().st_mtime_ns
        follower = log.TranscriptFollower(self.path, self.root)
        self.assertTrue(follower.poll())
        target = next((self.root/'.claude-logs').glob('*.md'))
        self.assertIn('awaiting_response', target.read_text())
        self.item('AgentMessage', 'Completed final', 1, 'a1', 'final_answer')
        self.write()
        os.utime(self.path, ns=(fixed, fixed))
        self.assertEqual(self.path.stat().st_mtime_ns, fixed)
        self.assertTrue(follower.poll())
        self.assertEqual(log.conversation(log.conversation_from_log(target.read_text())),
                         log.conversation(log.extract(self.rows)))
        before = target.read_bytes()
        self.assertFalse(follower.poll())
        self.assertEqual(target.read_bytes(), before)

    def test_partial_utf8_and_json_do_not_publish_partial_message(self):
        self.item('UserMessage', 'Submitted', 1, 'u1')
        self.write()
        follower = log.TranscriptFollower(self.path, self.root)
        follower.poll()
        target = next((self.root/'.claude-logs').glob('*.md'))
        before = target.read_bytes()
        self.item('AgentMessage', 'Final unicode: \u00e9', 1, 'a1', 'final_answer')
        record = (json.dumps(self.rows[-1],ensure_ascii=False)+'\n').encode('utf-8')
        cut = record.index('\u00e9'.encode('utf-8')) + 1
        with self.path.open('ab') as handle:
            handle.write(record[:cut])
        self.assertTrue(follower.poll())
        self.assertEqual(target.read_bytes(), before)
        with self.path.open('ab') as handle:
            handle.write(record[cut:])
        self.assertTrue(follower.poll())
        self.assertIn('Final unicode: \u00e9', target.read_text(encoding='utf-8'))

    def test_truncation_and_replacement_never_erase_history(self):
        self.item('UserMessage', 'Submitted', 1, 'u1')
        self.item('AgentMessage', 'First final', 1, 'a1', 'final_answer')
        self.write()
        follower = log.TranscriptFollower(self.path, self.root)
        follower.poll()
        target = next((self.root/'.claude-logs').glob('*.md'))
        before = target.read_bytes()
        self.path.write_bytes(b'{"partial":')
        with self.assertRaises(log.IncompleteSnapshot):
            follower.poll()
        self.assertEqual(target.read_bytes(), before)
        self.path.write_text(json.dumps(self.rows[0])+'\n'+json.dumps(self.rows[1])+'\n',encoding='utf-8')
        with self.assertRaises(log.IncompleteSnapshot):
            follower.poll()
        self.assertEqual(target.read_bytes(), before)
        self.item('UserMessage', 'Second submitted', 2, 'u2')
        replacement = self.root/'replacement.jsonl'
        replacement.write_text('\n'.join(json.dumps(r) for r in self.rows)+'\n',encoding='utf-8')
        replacement.replace(self.path)
        self.assertTrue(follower.poll())
        self.assertEqual(target.read_text().count('type=PROMPT'), 2)
        preserved = target.read_bytes()
        self.rows[0]['payload']['id'] = 'different-session'
        self.write()
        with self.assertRaises(ValueError):
            follower.poll()
        self.assertEqual(target.read_bytes(), preserved)
        self.assertEqual(len(list((self.root/'.claude-logs').glob('*.md'))), 1)

    def test_same_size_same_mtime_rewrite_is_detected(self):
        self.item('UserMessage', 'Message one', 1, 'u1')
        self.write()
        fixed = self.path.stat().st_mtime_ns
        follower = log.TranscriptFollower(self.path, self.root)
        follower.poll()
        target = next((self.root/'.claude-logs').glob('*.md'))
        before = target.read_bytes()
        size = self.path.stat().st_size
        self.rows[-1]['payload']['item']['content'][0]['text'] = 'Message two'
        self.write()
        os.utime(self.path, ns=(fixed, fixed))
        self.assertEqual(self.path.stat().st_size, size)
        self.assertEqual(self.path.stat().st_mtime_ns, fixed)
        with self.assertRaises(log.IncompleteSnapshot):
            follower.poll()
        self.assertEqual(target.read_bytes(), before)

    def test_content_whitespace_and_embedded_markers_are_preserved(self):
        text = '  text\n[CLAUDE_LOG_ENTRY type=RESPONSE num=1 session=fake]\n  '
        self.item('UserMessage', text, 1, 'u1')
        self.item('AgentMessage', '  final with spaces  \n', 1, 'a1', 'final_answer')
        target = self.export()
        self.assertEqual(log.conversation(log.conversation_from_log(target.read_text())),
                         log.conversation(log.extract(self.rows)))

    def test_malformed_terminated_record_is_rejected(self):
        self.item('UserMessage', 'Submitted', 1, 'u1')
        self.write()
        with self.path.open('ab') as handle:
            handle.write(b'{"broken":\n')
        with self.assertRaises(ValueError):
            log.read_rollout(self.path)

    def test_windows_replace_sharing_violation_is_retried(self):
        self.item('UserMessage', 'Submitted', 1, 'u1')
        real_replace = Path.replace
        attempts = []
        def temporarily_locked(source, target):
            attempts.append(1)
            if len(attempts) < 3:
                raise PermissionError('Simulated Windows reader handle')
            return real_replace(source, target)
        with patch.object(Path, 'replace', temporarily_locked), patch.object(log.time, 'sleep'):
            target = self.export()
        self.assertEqual(len(attempts), 3)
        self.assertIn('Submitted', target.read_text())

    def test_session_lock_serializes_writers(self):
        with log.session_lock(self.root, 'same-session'):
            with self.assertRaises(TimeoutError):
                with log.session_lock(self.root, 'same-session', timeout=0.01):
                    self.fail('Second writer entered the same session lock')
            with log.session_lock(self.root, 'other-session', timeout=0.01):
                pass
        with log.session_lock(self.root, 'same-session', timeout=0.01):
            pass

    def test_original_claude_extractor_still_generates_two_turns(self):
        # Run original code against fixtures, never against the real Claude logs.
        path = Path.home()/'.claude/extract-log.py'
        spec = importlib.util.spec_from_file_location('original_claude_extractor', path)
        claude = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(claude)
        sessions = self.root/'claude-fixture'
        sessions.mkdir()
        transcript = sessions/'test-original-claude.jsonl'
        rows = []
        with patch.object(claude, 'get_project_session_dir', return_value=sessions), patch.dict(os.environ, {'CLAUDE_CWD': str(self.root)}), patch.object(claude, 'get_git_author', return_value='test'), patch.object(claude, 'get_git_email', return_value='test'), patch.object(claude, 'get_github_user', return_value='test'):
            for turn in (1,2):
                rows.append(dict(type='user', timestamp=f'2026-11-06T05:0{turn}:00Z', message=dict(content=f'Claude prompt {turn}')))
                transcript.write_text('\n'.join(json.dumps(r) for r in rows), encoding='utf-8')
                claude.main()
                rows.append(dict(type='assistant', timestamp=f'2026-11-06T05:0{turn}:10Z', message=dict(content=[dict(type='text',text=f'Claude final {turn}')])))
                transcript.write_text('\n'.join(json.dumps(r) for r in rows), encoding='utf-8')
                claude.main()
            claude.main()
        text = next((self.root/'.claude-logs').glob('*.md')).read_text()
        self.assertEqual(text.count('type=PROMPT'), 2)
        self.assertEqual(text.count('type=RESPONSE'), 2)
        self.assertIn('Claude final 2', text)

if __name__ == '__main__':
    unittest.main(verbosity=2)

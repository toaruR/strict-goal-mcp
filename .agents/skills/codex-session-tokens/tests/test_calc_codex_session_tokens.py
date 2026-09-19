import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "calc_codex_session_tokens.py"
SPEC = importlib.util.spec_from_file_location("tokens", SCRIPT)
TOKENS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOKENS)


def write_rollout(path, identity, usage, child=None, parent=None):
    meta = {"id": identity, "session_id": parent or identity, "thread_source": "subagent" if parent else "user"}
    events = [
        {"type": "session_meta", "payload": meta},
        {"type": "turn_context", "payload": {"model": "test-model"}},
        {"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": usage}}},
    ]
    if child:
        events.append({"type": "event_msg", "payload": {"type": "item_completed", "item": {"type": "SubAgentActivity", "kind": "started", "agent_thread_id": child}}})
    path.write_text("\n".join(json.dumps(event) for event in events), encoding="utf-8")


class TokenTests(unittest.TestCase):
    def test_latest_cumulative_value_is_not_double_counted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rollout-root.jsonl"
            write_rollout(path, "root", {"input_tokens": 100, "cached_input_tokens": 60, "output_tokens": 20})
            with path.open("a", encoding="utf-8") as handle:
                handle.write("\n" + json.dumps({"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": 150, "cached_input_tokens": 90, "output_tokens": 30}}}}))
            parsed = TOKENS.parse_rollout(path)
            self.assertEqual(parsed["token_events"], 2)
            self.assertEqual(parsed["usage"]["billed_total_tokens"], 90)

    def test_parent_and_child_are_summed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            parent, child = root / "rollout-parent.jsonl", root / "rollout-child.jsonl"
            write_rollout(parent, "parent", {"input_tokens": 100, "cached_input_tokens": 70, "output_tokens": 10}, child="child")
            write_rollout(child, "child", {"input_tokens": 50, "cached_input_tokens": 20, "output_tokens": 5}, parent="parent")
            sessions, warnings = TOKENS.collect_hierarchy(parent, root)
            total = TOKENS.sum_usage(sessions)
            self.assertEqual(warnings, [])
            self.assertEqual(len(sessions), 2)
            self.assertEqual(total["cached_input_tokens"], 90)
            self.assertEqual(total["uncached_input_tokens"], 60)
            self.assertEqual(total["output_tokens"], 15)
            self.assertEqual(total["billed_total_tokens"], 75)


if __name__ == "__main__":
    unittest.main()

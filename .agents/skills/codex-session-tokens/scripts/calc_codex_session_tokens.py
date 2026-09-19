#!/usr/bin/env python3
"""Report token usage for a Codex rollout and its spawned subagents."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Iterable


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                yield value


def get_meta(path: Path) -> dict[str, Any]:
    for event in read_jsonl(path):
        if event.get("type") == "session_meta":
            payload = event.get("payload")
            return payload if isinstance(payload, dict) else {}
    return {}


def thread_id(meta: dict[str, Any]) -> str | None:
    value = meta.get("id") or meta.get("session_id")
    return value if isinstance(value, str) and value else None


def find_rollout(sessions_dir: Path, target_id: str) -> Path | None:
    paths = sorted(sessions_dir.rglob(f"*{target_id}*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return next((p for p in paths if thread_id(get_meta(p)) == target_id), None)


def find_latest_user_rollout(sessions_dir: Path) -> Path | None:
    paths = sorted(sessions_dir.rglob("rollout-*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in paths:
        meta = get_meta(path)
        if meta.get("thread_source") != "subagent" and thread_id(meta):
            return path
    return None


def normalize_usage(raw: dict[str, Any] | None) -> dict[str, int]:
    raw = raw or {}

    def count(name: str) -> int:
        value = raw.get(name, 0)
        return value if isinstance(value, int) and value >= 0 else 0

    input_tokens = count("input_tokens")
    cached = min(count("cached_input_tokens"), input_tokens)
    output = count("output_tokens")
    reasoning = min(count("reasoning_output_tokens"), output)
    uncached = input_tokens - cached
    return {
        "input_tokens": input_tokens,
        "cached_input_tokens": cached,
        "uncached_input_tokens": uncached,
        "output_tokens": output,
        "reasoning_output_tokens": reasoning,
        "billed_total_tokens": uncached + output,
        "all_processed_tokens": input_tokens + output,
    }


def parse_rollout(path: Path) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    latest_usage = None
    children: list[str] = []
    models: list[str] = []
    token_events = 0
    for event in read_jsonl(path):
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        if event.get("type") == "session_meta":
            meta = payload
        elif event.get("type") == "turn_context":
            model = payload.get("model")
            if isinstance(model, str) and model not in models:
                models.append(model)
        elif event.get("type") == "event_msg" and payload.get("type") == "token_count":
            info = payload.get("info")
            if isinstance(info, dict) and isinstance(info.get("total_token_usage"), dict):
                latest_usage = info["total_token_usage"]
                token_events += 1
        elif event.get("type") == "event_msg" and payload.get("type") == "item_completed":
            item = payload.get("item")
            if isinstance(item, dict):
                child = item.get("agent_thread_id")
                if item.get("type") == "SubAgentActivity" and item.get("kind") == "started" and isinstance(child, str) and child not in children:
                    children.append(child)
    actual_id = thread_id(meta)
    if not actual_id:
        raise ValueError(f"session_meta with thread id not found: {path}")
    return {
        "thread_id": actual_id,
        "role": "subagent" if meta.get("thread_source") == "subagent" else "parent",
        "agent_path": meta.get("agent_path"),
        "models": models,
        "rollout_path": str(path),
        "token_events": token_events,
        "usage": normalize_usage(latest_usage),
        "child_thread_ids": children,
        "has_token_usage": latest_usage is not None,
    }


def collect_hierarchy(root: Path, sessions_dir: Path, include_children: bool = True):
    sessions, warnings, queue, visited = [], [], [root], set()
    while queue:
        parsed = parse_rollout(queue.pop(0))
        current_id = parsed["thread_id"]
        if current_id in visited:
            continue
        visited.add(current_id)
        sessions.append(parsed)
        if not parsed["has_token_usage"]:
            warnings.append(f"No token_count event found for {current_id}")
        if include_children:
            for child_id in parsed["child_thread_ids"]:
                child = find_rollout(sessions_dir, child_id)
                if child is None:
                    warnings.append(f"Rollout not found for spawned child {child_id}")
                elif child_id not in visited:
                    queue.append(child)
    return sessions, warnings


def sum_usage(sessions: list[dict[str, Any]]) -> dict[str, int]:
    keys = ("input_tokens", "cached_input_tokens", "uncached_input_tokens", "output_tokens", "reasoning_output_tokens", "billed_total_tokens", "all_processed_tokens")
    return {key: sum(item["usage"][key] for item in sessions) for key in keys}


def markdown(report: dict[str, Any]) -> str:
    total, root = report["summary"], report["sessions"][0]
    models = ", ".join(root["models"]) or "unknown"
    lines = [
        "# Codex Session Token Report", "",
        f"- **Thread ID**: `{report['thread_id']}`",
        f"- **Model**: `{models}`",
        f"- **Sessions**: {len(report['sessions'])} (parent 1, subagents {len(report['sessions']) - 1})", "",
        "## Token Usage Summary", "",
        "| Metric | Tokens |", "|---|---:|",
        f"| Cached Input | {total['cached_input_tokens']:,} |",
        f"| Uncached Input | {total['uncached_input_tokens']:,} |",
        f"| Output | {total['output_tokens']:,} |",
        f"| Billed Total (Uncached + Output) | {total['billed_total_tokens']:,} |",
        f"| All Processed (Input + Output) | {total['all_processed_tokens']:,} |",
    ]
    if len(report["sessions"]) > 1:
        lines += ["", "## Session Breakdown", "", "| Thread | Role | Cached | Uncached | Output | Billed |", "|---|---|---:|---:|---:|---:|"]
        for item in report["sessions"]:
            usage = item["usage"]
            role = item.get("agent_path") or item["role"]
            lines.append(f"| `{item['thread_id']}` | {role} | {usage['cached_input_tokens']:,} | {usage['uncached_input_tokens']:,} | {usage['output_tokens']:,} | {usage['billed_total_tokens']:,} |")
    if report["warnings"]:
        lines += ["", "## Warnings", ""] + [f"- {warning}" for warning in report["warnings"]]
    lines += ["", "> Billed Total は比較用のトークン指標であり、実際の料金ではありません。"]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-id")
    parser.add_argument("--rollout", type=Path)
    parser.add_argument("--sessions-dir", type=Path, default=Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "sessions")
    parser.add_argument("--no-subagents", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    sessions_dir = args.sessions_dir.expanduser().resolve()
    try:
        if args.rollout:
            root = args.rollout.expanduser().resolve()
            if not root.is_file():
                raise FileNotFoundError(f"Rollout not found: {root}")
        else:
            target = args.session_id or os.environ.get("CODEX_THREAD_ID") or os.environ.get("CODEX_SESSION_ID")
            root = find_rollout(sessions_dir, target) if target else find_latest_user_rollout(sessions_dir)
            if root is None:
                raise FileNotFoundError(f"Rollout not found under {sessions_dir}" + (f" for {target}" if target else ""))
        sessions, warnings = collect_hierarchy(root, sessions_dir, not args.no_subagents)
        report = {"thread_id": sessions[0]["thread_id"], "rollout_path": str(root), "summary": sum_usage(sessions), "sessions": sessions, "warnings": warnings}
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2) if args.json else markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

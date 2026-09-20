#!/usr/bin/env python3
"""Claude Code セッションの消費トークンを集計する（親 + Agent ツール起動のサブエージェント）。

データ源: ~/.claude/projects/<project-dir>/<session_id>.jsonl
        ~/.claude/projects/<project-dir>/<session_id>/subagents/agent-*.jsonl
        ~/.claude/projects/<project-dir>/<session_id>/subagents/agent-*.meta.json

注意: jsonl は content ブロックごとに 1 行で同一 usage を複写するため、
message.id で重複排除しないと 2〜3 倍に過大計上される。
"""
import argparse
import glob
import json
import os
import re
import sys

USAGE_KEYS = (
    "input_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "output_tokens",
)


def empty_model():
    m = {k: 0 for k in USAGE_KEYS}
    m["turns"] = 0
    m["thinking_tokens"] = 0
    return m


def empty_acc():
    acc = empty_model()
    acc["by_model"] = {}
    return acc


def add_usage(acc, model, u):
    acc["turns"] += 1
    m = acc["by_model"].setdefault(model, empty_model())
    m["turns"] += 1
    for k in USAGE_KEYS:
        v = u.get(k) or 0
        acc[k] += v
        m[k] += v
    th = (u.get("output_tokens_details") or {}).get("thinking_tokens") or 0
    acc["thinking_tokens"] += th
    m["thinking_tokens"] += th


def sum_jsonl(path):
    """message.id で重複排除しつつ usage を合算。"""
    acc = empty_acc()
    seen = {}
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            msg = o.get("message")
            if not isinstance(msg, dict):
                continue
            u = msg.get("usage")
            if not isinstance(u, dict):
                continue
            key = msg.get("id") or o.get("uuid") or str(len(seen))
            # 同一 message.id は最後に出た usage を採用（値は同一のはず）
            seen[key] = (msg.get("model") or "unknown", u)
    for model, u in seen.values():
        add_usage(acc, model, u)
    return acc


def merge(dst, src):
    for k in ("turns", "thinking_tokens", *USAGE_KEYS):
        dst[k] += src[k]
    for model, m in src["by_model"].items():
        d = dst["by_model"].setdefault(model, empty_model())
        for k in m:
            d[k] += m[k]


def project_dir_name(cwd):
    # Claude Code は cwd の英数字以外を '-' に置換してプロジェクトディレクトリ名にする
    return re.sub(r"[^A-Za-z0-9]", "-", os.path.abspath(cwd))


def find_session_file(session_id, projects_root, cwd):
    if cwd:
        p = os.path.join(projects_root, project_dir_name(cwd), f"{session_id}.jsonl")
        if os.path.exists(p):
            return p
    cands = glob.glob(os.path.join(projects_root, "*", f"{session_id}.jsonl"))
    return cands[0] if cands else None


def find_latest_session(projects_root, cwd):
    dirs = [os.path.join(projects_root, project_dir_name(cwd))] if cwd else []
    if not dirs or not os.path.isdir(dirs[0]):
        dirs = glob.glob(os.path.join(projects_root, "*"))
    best = None
    for d in dirs:
        for f in glob.glob(os.path.join(d, "*.jsonl")):
            try:
                mt = os.path.getmtime(f)
            except OSError:
                continue
            if best is None or mt > best[0]:
                best = (mt, f)
    return best[1] if best else None


def subagent_label(agent_file):
    """agent-*.jsonl に対応する agent-*.meta.json から agentType/description を読む。"""
    meta_path = os.path.splitext(agent_file)[0] + ".meta.json"
    if not os.path.exists(meta_path):
        return None, None
    try:
        with open(meta_path, "r", encoding="utf-8", errors="replace") as f:
            meta = json.load(f)
    except Exception:
        return None, None
    return meta.get("agentType"), meta.get("description")


def find_subagent_files(session_dir):
    """親セッション直下の subagents/ に加え、入れ子で起動された孫サブエージェントも再帰的に探す。"""
    files = []
    seen_dirs = set()
    pending = [os.path.join(session_dir, "subagents")]
    while pending:
        sub_dir = pending.pop()
        if sub_dir in seen_dirs or not os.path.isdir(sub_dir):
            continue
        seen_dirs.add(sub_dir)
        for f in sorted(glob.glob(os.path.join(sub_dir, "agent-*.jsonl"))):
            files.append(f)
            nested = os.path.splitext(f)[0]
            if os.path.isdir(os.path.join(nested, "subagents")):
                pending.append(os.path.join(nested, "subagents"))
    return files


def derived(a):
    uncached = a["input_tokens"] + a["cache_creation_input_tokens"]
    cached = a["cache_read_input_tokens"]
    return {
        "turns": a["turns"],
        "cached_tokens": cached,
        "uncached_input_tokens": uncached,
        "prompt_tokens": cached + uncached,
        "output_tokens": a["output_tokens"],
        "thinking_tokens": a["thinking_tokens"],
        "total_billed_tokens": uncached + a["output_tokens"],
        "total_tokens": cached + uncached + a["output_tokens"],
    }


def fmt(n):
    return f"{n:,}"


def main():
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")

    ap = argparse.ArgumentParser(description="Claude Code セッションの消費トークンを集計する")
    ap.add_argument("--session-id", "-s", help="対象セッション ID。省略時は $CLAUDE_CODE_SESSION_ID → 最新 jsonl の順で解決")
    ap.add_argument("--cwd", default=os.getcwd(), help="プロジェクトディレクトリ解決に使う作業ディレクトリ")
    ap.add_argument("--projects-root", default=os.path.join(os.path.expanduser("~"), ".claude", "projects"))
    ap.add_argument("--json", action="store_true", help="JSON で出力")
    args = ap.parse_args()

    sid = args.session_id or os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID")
    if sid:
        path = find_session_file(sid, args.projects_root, args.cwd)
        if not path:
            sys.stderr.write(f"session jsonl not found: {sid}\n")
            sys.exit(1)
    else:
        path = find_latest_session(args.projects_root, args.cwd)
        if not path:
            sys.stderr.write("no Claude Code session jsonl found\n")
            sys.exit(1)
        sid = os.path.splitext(os.path.basename(path))[0]

    parent = sum_jsonl(path)
    session_dir = os.path.join(os.path.dirname(path), sid)
    subagents = []
    for f in find_subagent_files(session_dir):
        s = sum_jsonl(f)
        if s["turns"] == 0:
            continue
        s["agent_id"] = os.path.splitext(os.path.basename(f))[0]
        agent_type, description = subagent_label(f)
        s["agent_type"] = agent_type or "-"
        s["description"] = description or "-"
        subagents.append(s)

    total = empty_acc()
    merge(total, parent)
    for s in subagents:
        merge(total, s)

    report = {
        "session_id": sid,
        "session_file": path,
        "total_turns": total["turns"],
        "summary": derived(total),
        "by_model": {m: derived(v) for m, v in total["by_model"].items()},
        "parent_session": derived(parent),
        "subagents": [
            dict(derived(s), agent_id=s["agent_id"], agent_type=s["agent_type"], description=s["description"])
            for s in subagents
        ],
    }

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return

    S = report["summary"]
    sub_turns = sum(s["turns"] for s in subagents)
    print("# Claude Code Session Token Report")
    print(f"- **Session ID**: `{sid}`")
    print(f"- **Session File**: `{path}`")
    print(f"- **Models**: {', '.join(f'`{m}`' for m in report['by_model']) or '-'}")
    print(f"- **API Turns**: `{total['turns']}` (Parent: {parent['turns']}, Subagents: {len(subagents)} files / {sub_turns} turns)")
    print()
    print("## Token Usage Summary (総計)")
    print("| Metric | Tokens | 備考 |")
    print("|---|---|---|")
    print(f"| **Prompt Cached Tokens** | **{fmt(S['cached_tokens'])}** | cache_read_input_tokens |")
    print(f"| **Prompt Uncached Tokens** | **{fmt(S['uncached_input_tokens'])}** | input_tokens + cache_creation_input_tokens |")
    print(f"| **Output Tokens** | **{fmt(S['output_tokens'])}** | 生成トークン (うち thinking {fmt(S['thinking_tokens'])}) |")
    print(f"| **Total Billed Tokens** | **{fmt(S['total_billed_tokens'])}** | Uncached + Output |")
    print(f"| **Total Tokens** | **{fmt(S['total_tokens'])}** | Cached + Uncached + Output |")
    print()
    if len(report["by_model"]) > 1:
        print("## By Model")
        print("| Model | Turns | Cached | Uncached | Output | Billed |")
        print("|---|---|---|---|---|---|")
        for m, v in report["by_model"].items():
            print(f"| `{m}` | {v['turns']} | {fmt(v['cached_tokens'])} | {fmt(v['uncached_input_tokens'])} | {fmt(v['output_tokens'])} | **{fmt(v['total_billed_tokens'])}** |")
        print()
    if subagents:
        P = report["parent_session"]
        print("## Session Hierarchy Breakdown (内訳)")
        print("| Session | Role | Turns | Cached | Uncached | Output | Billed |")
        print("|---|---|---|---|---|---|---|")
        print(f"| `{sid[:8]}...` | **Parent** | {P['turns']} | {fmt(P['cached_tokens'])} | {fmt(P['uncached_input_tokens'])} | {fmt(P['output_tokens'])} | **{fmt(P['total_billed_tokens'])}** |")
        for s in report["subagents"]:
            role = s["agent_type"] if s["agent_type"] != "-" else "Subagent"
            print(f"| `{s['agent_id']}` | {role} | {s['turns']} | {fmt(s['cached_tokens'])} | {fmt(s['uncached_input_tokens'])} | {fmt(s['output_tokens'])} | **{fmt(s['total_billed_tokens'])}** |")


if __name__ == "__main__":
    main()

import os
import sys
import glob
import sqlite3
import json
import argparse
from datetime import datetime

def decode_protobuf(data):
    """Simple zero-dependency protobuf wire decoder."""
    idx = 0
    res = []
    length_data = len(data)
    while idx < length_data:
        key = 0
        shift = 0
        while True:
            if idx >= length_data:
                return res
            b = data[idx]
            idx += 1
            key |= (b & 0x7F) << shift
            if not (b & 0x80):
                break
            shift += 7
        field_num = key >> 3
        wire_type = key & 0x07
        if wire_type == 0:  # varint
            val = 0
            shift = 0
            while True:
                if idx >= length_data:
                    break
                b = data[idx]
                idx += 1
                val |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            res.append((field_num, 'varint', val))
        elif wire_type == 2:  # length-delimited
            val_len = 0
            shift = 0
            while True:
                if idx >= length_data:
                    break
                b = data[idx]
                idx += 1
                val_len |= (b & 0x7F) << shift
                if not (b & 0x80):
                    break
                shift += 7
            val = data[idx:idx + val_len]
            idx += val_len
            res.append((field_num, 'bytes', val))
        else:
            # Unsupported wire type, skip or abort
            break
    return res

def parse_session_db(db_path):
    if not os.path.exists(db_path):
        return None

    try:
        conn = sqlite3.connect(f"file:{os.path.abspath(db_path)}?mode=ro", uri=True)
    except Exception:
        try:
            conn = sqlite3.connect(db_path)
        except Exception:
            return None

    total_uncached = 0
    total_output = 0
    total_cached = 0
    steps_count = 0
    model_name = "Unknown"

    try:
        import re
        for row in conn.execute("SELECT data FROM gen_metadata WHERE data IS NOT NULL"):
            matches = re.findall(rb'(?:gemini|claude|gpt)-[a-zA-Z0-9\.\-]+', row[0])
            if matches:
                model_name = matches[-1].decode('latin1')
                break
    except Exception:
        pass

    try:
        query = "SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL ORDER BY idx"
        for row in conn.execute(query):
            raw_meta = row[1]
            fields = decode_protobuf(raw_meta)
            for f in fields:
                if f[0] == 9 and f[1] == 'bytes':
                    sub = decode_protobuf(f[2])
                    d = {s[0]: s[2] for s in sub if s[1] == 'varint'}
                    # field 2: input uncached, field 3: output, field 5: cached
                    f2 = d.get(2, 0)
                    f3 = d.get(3, 0)
                    f5 = d.get(5, 0)
                    if f2 > 0 or f3 > 0 or f5 > 0:
                        total_uncached += f2
                        total_output += f3
                        total_cached += f5
                        steps_count += 1
    except Exception as e:
        sys.stderr.write(f"Error reading steps: {e}\n")
    finally:
        conn.close()

    total_billed = total_uncached + total_output
    total_prompt = total_uncached + total_cached

    return {
        "db_path": db_path,
        "model": model_name,
        "steps_count": steps_count,
        "cached_tokens": total_cached,
        "uncached_input_tokens": total_uncached,
        "prompt_tokens": total_prompt,
        "output_tokens": total_output,
        "total_billed_tokens": total_billed,
    }

def find_latest_db(base_dirs):
    candidates = []
    for b in base_dirs:
        conv_dir = os.path.join(b, "conversations")
        if os.path.isdir(conv_dir):
            for f in glob.glob(os.path.join(conv_dir, "*.db")):
                try:
                    mtime = os.path.getmtime(f)
                    candidates.append((mtime, f))
                except Exception:
                    pass
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]

def find_session_db(conversation_id, base_dirs):
    for b in base_dirs:
        p = os.path.join(b, "conversations", f"{conversation_id}.db")
        if os.path.exists(p):
            return p
    return None

def find_subagents_for_session(conversation_id, base_dirs):
    """Scan transcript for any invoke_subagent conversation IDs."""
    subagent_ids = []
    for b in base_dirs:
        transcript_path = os.path.join(b, "brain", conversation_id, ".system_generated", "logs", "transcript.jsonl")
        if os.path.exists(transcript_path):
            try:
                with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if "conversationId" in line or "conversation_id" in line:
                            import re
                            # match uuid
                            uuids = re.findall(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', line)
                            for u in uuids:
                                if u != conversation_id and u not in subagent_ids:
                                    subagent_ids.append(u)
            except Exception:
                pass
    return subagent_ids

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Calculate token usage for an Antigravity (AGY) session.")
    parser.add_argument("--conversation-id", "-c", help="Conversation ID to inspect. If omitted, uses the latest active session.")
    parser.add_argument("--json", action="store_true", help="Output in JSON format.")
    args = parser.parse_args()

    home = os.path.expanduser("~")
    base_dirs = [
        os.path.join(home, ".gemini", "antigravity-ide"),
        os.path.join(home, ".gemini", "antigravity-cli"),
    ]

    target_id = args.conversation_id
    if target_id:
        target_db = find_session_db(target_id, base_dirs)
        if not target_db:
            sys.stderr.write(f"Could not find conversation DB for ID: {target_id}\n")
            sys.exit(1)
    else:
        target_db = find_latest_db(base_dirs)
        if not target_db:
            sys.stderr.write("No Antigravity conversation databases found.\n")
            sys.exit(1)
        target_id = os.path.splitext(os.path.basename(target_db))[0]

    parent_stats = parse_session_db(target_db)
    if not parent_stats:
        sys.stderr.write(f"Failed to parse database: {target_db}\n")
        sys.exit(1)

    # Subagents
    subagent_ids = find_subagents_for_session(target_id, base_dirs)
    subagent_stats = []
    for sid in subagent_ids:
        sdb = find_session_db(sid, base_dirs)
        if sdb:
            s_parsed = parse_session_db(sdb)
            if s_parsed and s_parsed["steps_count"] > 0:
                s_parsed["conversation_id"] = sid
                subagent_stats.append(s_parsed)

    combined_cached = parent_stats["cached_tokens"] + sum(s["cached_tokens"] for s in subagent_stats)
    combined_uncached = parent_stats["uncached_input_tokens"] + sum(s["uncached_input_tokens"] for s in subagent_stats)
    combined_output = parent_stats["output_tokens"] + sum(s["output_tokens"] for s in subagent_stats)
    combined_billed = combined_uncached + combined_output
    total_steps = parent_stats["steps_count"] + sum(s["steps_count"] for s in subagent_stats)

    report = {
        "conversation_id": target_id,
        "model": parent_stats["model"],
        "total_steps": total_steps,
        "summary": {
            "cached_tokens": combined_cached,
            "uncached_input_tokens": combined_uncached,
            "output_tokens": combined_output,
            "total_billed_tokens": combined_billed,
        },
        "parent_session": parent_stats,
        "subagents": subagent_stats,
    }

    if args.json:
        print(json.dumps(report, indent=2))
        return

    # Formatted Markdown report
    print(f"# AGY Session Token Report")
    print(f"- **Conversation ID**: `{target_id}`")
    print(f"- **Detected Model**: `{parent_stats['model']}`")
    print(f"- **Total LLM Steps**: `{total_steps}` (Parent: {parent_stats['steps_count']}, Subagents: {len(subagent_stats)})")
    print()
    print("## 📊 Token Usage Summary (総計)")
    print("| Metric (指標) | Tokens | 備考 |")
    print("|---|---|---|")
    print(f"| **Prompt Cached Tokens** | **{combined_cached:,}** | プロンプトキャッシュ読込 |")
    print(f"| **Prompt Uncached Tokens** | **{combined_uncached:,}** | 新規入力トークン |")
    print(f"| **Output Tokens** | **{combined_output:,}** | 生成（Thinking含む）トークン |")
    print(f"| **Total Billed Tokens** | **{combined_billed:,}** | 実課金対象合計 (Uncached + Output) |")
    print()

    if subagent_stats:
        print("## 🤖 Session Hierarchy Breakdown (内訳)")
        print("| Session | Role | Steps | Cached Input | Uncached Input | Output | Billed Total |")
        print("|---|---|---|---|---|---|---|")
        print(f"| `{target_id[:8]}...` | **Parent (親)** | {parent_stats['steps_count']} | {parent_stats['cached_tokens']:,} | {parent_stats['uncached_input_tokens']:,} | {parent_stats['output_tokens']:,} | **{parent_stats['total_billed_tokens']:,}** |")
        for s in subagent_stats:
            print(f"| `{s['conversation_id'][:8]}...` | Subagent | {s['steps_count']} | {s['cached_tokens']:,} | {s['uncached_input_tokens']:,} | {s['output_tokens']:,} | **{s['total_billed_tokens']:,}** |")

if __name__ == "__main__":
    main()

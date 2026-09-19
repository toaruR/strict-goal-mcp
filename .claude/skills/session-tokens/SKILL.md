---
name: session-tokens
description: Calculate and display token consumption (cached input, uncached input, output, billed total) for the active Claude Code session and any Agent-tool subagents it spawned.
---

# Session Token Calculator (`/session-tokens`)

現在の Claude Code セッション（および Agent ツールで起動したサブエージェント）の消費トークン数を `~/.claude/projects/` 配下の jsonl から集計して表示する。

## 実行手順

1. 以下を実行する（セッション ID は `$CLAUDE_CODE_SESSION_ID` から自動解決）：
   ```bash
   python .claude/skills/session-tokens/scripts/calc_session_tokens.py
   ```
   過去セッションを指定する場合：
   ```bash
   python .claude/skills/session-tokens/scripts/calc_session_tokens.py --session-id "<SESSION_ID>"
   ```
   機械可読出力が必要なら `--json` を付ける。

2. 出力の Markdown をそのままユーザーに報告する。
   - **Prompt Cached Tokens**: `cache_read_input_tokens`（キャッシュ読込・割引対象）
   - **Prompt Uncached Tokens**: `input_tokens + cache_creation_input_tokens`
   - **Output Tokens**: 生成トークン（thinking 内訳付き）
   - **Total Billed Tokens**: Uncached + Output
   - **By Model**: 複数モデルが混在する場合のモデル別内訳
   - **Subagents**: `<session_id>/subagents/agent-*.jsonl` があれば階層別内訳を提示

## 注意

- jsonl は content ブロックごとに同一 `usage` を複写するため `message.id` で重複排除している（行単位合計は 2〜3 倍に過大）。
- サブエージェント消費はメインの jsonl に含まれないので別途合算している。
- 集計はスクリプト実行時点の値。実行後の応答分は含まれない。

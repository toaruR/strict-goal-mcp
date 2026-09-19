---
name: session-tokens
description: Calculate and display token consumption (cached input, uncached input, output, billed total) for the active Antigravity (AGY) session and any invoked subagents.
---

# Session Token Calculator (`/session-tokens`)

このスキルは、現在アクティブな Antigravity (AGY IDE / CLI) セッション、およびセッション内で呼び出されたサブエージェント全体の消費トークン数をリアルタイムに集計・表示します。

## 実行手順

1. 以下のコマンドを実行してトークン使用量を集計します：
   ```pwsh
   python .agents/skills/session-tokens/scripts/calc_session_tokens.py
   ```
   ※ 特定の会話ID（過去セッション）を指定して集計したい場合：
   ```pwsh
   python .agents/skills/session-tokens/scripts/calc_session_tokens.py --conversation-id "<CONVERSATION_ID>"
   ```

2. スクリプトの出力をそのまま、または見やすい Markdown テーブル形式でユーザーに報告します。
   - **Prompt Cached Tokens**: プロンプトキャッシュから読み出されたトークン（通常は割引または無償）
   - **Prompt Uncached Tokens**: 新規に送信された入力トークン
   - **Output Tokens**: モデルが生成した応答・思考（Thinking）トークン
   - **Total Billed Tokens**: 実課金対象トークン合計（Uncached Input + Output）
   - **Subagents**: サブエージェントが呼び出されていた場合は、階層別の消費内訳も提示します。

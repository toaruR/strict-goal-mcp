---
name: codex-session-tokens
description: Calculate and report token consumption for the active Codex session, including cached input, uncached input, output, billed total, and recursively spawned subagents.
---

# Codex Session Token Calculator

現在の Codex セッションと、そこから起動された子エージェントのトークン使用量を集計する。

## 実行

プロジェクトルートで実行する。

```pwsh
python -X utf8 .agents/skills/codex-session-tokens/scripts/calc_codex_session_tokens.py
```

`CODEX_THREAD_ID`、次に `CODEX_SESSION_ID` から現在のセッションを特定する。両方ない場合だけ最新のユーザーセッションへフォールバックする。

過去セッションは `--session-id "<THREAD_ID>"`、JSON 出力は `--json`、親だけの集計は `--no-subagents` を指定する。

## 報告

スクリプトの Markdown 出力をそのまま提示する。以下を混同しない。

- **Cached Input**: 入力のうちキャッシュから読み出された分。
- **Uncached Input**: `input_tokens - cached_input_tokens`。
- **Output**: 出力トークン。`reasoning_output_tokens` は内数なので二重加算しない。
- **Billed Total**: 比較用に `Uncached Input + Output` と定義する。実際の請求額ではない。
- **All Processed**: `Input + Output`。キャッシュ分を含む。

rollout の `token_count.info.total_token_usage` は累積値なので、各セッションの最後の有効値だけを使う。イベントを合算しない。親子内訳と総計を併記し、読み取れない子があれば警告も報告する。

fork された子 rollout に親履歴由来の `session_meta` が後続していても、ファイル先頭側の最初の `session_meta` をその rollout 自身の識別子として扱う。

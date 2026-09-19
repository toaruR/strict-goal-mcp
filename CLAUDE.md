<!-- knowledge-kit:begin section=general-instructions version=1.12.1 -->
## Communication Style
- Use Caveman mode.
- Drop filler words, preambles, and recaps.
- Be extremely concise. Keep explanations under 2 sentences.
- Full code, minimal chatter.

## プランの保存場所
planモードで作成したマークダウンファイルは、<プロジェクトルート>docs/plans 以下に保存する。

## 返信の言語
最終的な返信は日本語で出力する。

## コード検索の指示方針
- コードベースの機能調査やコード探索を行う際は、最初に MCP ツール `search` (BM25 Code Search) を優先して使用してください。
- **Claude Code での呼び出し手順**: Claude Code では MCP ツールが Deferred Tool となるため、初回呼び出し前に必ず `ToolSearch` (`select:mcp__bm25-code-search__search`) でスキーマをロードしてから `mcp__bm25-code-search__search` を実行してください。
- `search` で結果が得られない場合、または特定のシンボル名の完全一致を直接検索する場合にのみ `grep_search` や `glob` を使用してください。

## Agents / Subagents
- Strict-goal subagents under `.claude/agents/` are launched and delegated via `Agent(subagent_type="<name>", prompt=...)`:
  - `sg-implementer`: In-loop implementation supervisor (session lifecycle, task breakdown, delegation to `sg-worker`).
  - `sg-worker`: Single-task worker (TDD implementation and drafting without strict-goal harness tools).
  - `sg-coder`: Autonomous implementer (completes smaller goals standalone through loop).
  - `sg-scout`: Ephemeral codebase explorer (stateless fact gathering without context pollution).
  - `sg-verifier`: Ephemeral test verification and evaluation submitter.
- **SKILL.state & ライフサイクル委譲規約（トークン抑制の必須原則）**:
  - **親の直接作業厳禁**: 親エージェントは自己採点・証拠抽出・ハッシュ計算・スクリプト試行錯誤を直接行わず、執筆・修正を `sg-worker`、検証・採点を `sg-verifier` に全フェーズ（design/plan/implement）で委譲すること（$\mathcal{O}(T^2)$ トークン爆発防止）。
  - **LLMによる設計スコープ自律判定**: `strict-goal design` 着手時は、プロンプトの意味的責務境界を判定し、通常のソフトウェア・クラス設計なら汎用 `design`（8基準）、エージェント自律基盤・ハーネスなら `design.harness`（17基準）を `loop_open` 時に選択すること。
  - **状態外出しの徹底**: 過去ログを遡らず、`loop_state(projection: "skill_state")` の有界三つ組 $(P, \Sigma_t, O_t)$ のみで現在地と次アクションを決定すること。
<!-- knowledge-kit:end section=general-instructions -->

<!-- knowledge-kit:begin section=recording-rules version=1.12.1 -->
## 知見の記録ルール

**作業中に重要な知見を発見したら、ユーザーの指示を待たず自動で記録すること。**

| 種類 | 記録先 | 例 |
|---|---|---|
| また踏むバグ・罠 | `CLAUDE.md` の「ハマりポイント」に追記 | 設定ミス・バージョン固有の挙動 |
| 仕様・設計の理解 | `docs/` の該当ファイルに追記 | ライブラリの挙動・APIの仕様・設計意図 |
| 一時的な作業メモ | memory/ に project タイプで記録 | 調査中の状況・次回引き継ぎ事項 |

記録したら「〇〇をハマりポイントに追記しました」と一言報告する。
<!-- knowledge-kit:end section=recording-rules -->

<!-- knowledge-kit:begin section=gotchas version=1.12.1 -->
## ハマりポイント

<!--
書き方のルール（このコメントは残してよい）:
- 1項目 = 1箇条書き。先頭を **太字** で「何が起きるか／何に注意するか」を要約する
- 対処法・原因まで1項目内に書き切る。長くなる場合は docs/ に本文を移し、「（詳細: `@docs/xxx.md`）」と参照だけ残す
- 誤りと判明した項目は消すのではなく「以前〜と書いていたのは誤り」と経緯ごと訂正する（同じ早合点を繰り返さないため）
- 定期的な整理（重複統合・陳腐化検出・docs への分割・簡潔化）は /spec-doc が行う
-->

- （ここに知見を追記していく）
- **Git Bash の `/tmp` と Windows Python の `/tmp` は別物**: bash の `/tmp/x` を Windows Python で開くと `FileNotFoundError`（Python は `D:\tmp` を参照）。一時ファイルは scratchpad の絶対パスで統一するか、片方の環境だけで完結させること。
- **文字列置換パッチのアンカーは行末まで取る**: 短いアンカーは別節と衝突して `MATCH 2` で落ちる。置換で末尾が伸びると後から衝突することもあるため、句点を含む行末までアンカーを取ること。
- **Bash の長文ヒアドキュメントは途中切断で失敗しうる**: 数百行の日本語・コード混在を `cat >> file <<'EOF'` で流すと `unexpected EOF` になることがある。Write ツールで一時ファイルに書き `cat chunk >> target` で連結し、`grep -n '^## '` で欠落がないか確認すること。
- **`grep -o 'E_[A-Z0-9_]*'` は語境界なしだと偽陽性を出す**: `XDG_STATE_HOME` を `E_HOME` として拾うため、`\bE_[A-Z][A-Z0-9_]*\b` を使うか出現箇所を1件ずつ確認すること。
- **`score_submit` の anti-gaming 検査はスコア上昇時のみ発火し、stale が inflation/jump より先行する**: `checkEvidenceStale` / `checkScoreJump` は `currentScore <= previousScore` なら即 return する。スコアを上げて inflation や jump を単独で検証したい場合、根拠 excerpt が前周と同一だと先に `E_EVIDENCE_STALE` が飛ぶため、excerpt を新しい文に変えて stale を回避すること。
- **1周で3点超のスコア改善は `exit_code: 0` の command 根拠が2件以上必須**: `checkScoreJump` により、急激な加点には終了コード 0 の command 根拠が要求される。
- **散文の「優先順位」は効かないが、`criterion.priority`（0〜3）で `buildMustFix` がソートされる**: 判定は全基準9点以上の最小値ゲートだが、基準に `priority` を設定することで `buildMustFix` が priority 降順・スコア昇順でソートされ、重要課題が優先提示される。
- **階層サブエージェント実行時のクライアント別探索パスの注意点**: サブエージェント定義は Claude Code が `.claude/agents/`、Codex が `.codex/agents/*.toml`、Antigravity が `.agents/agents/` を参照する。環境ごとに適切なディレクトリへ配置・追跡する必要がある（詳細: `@docs/design-quantitative-evaluation.md`）。
- **テスト実行環境・アサーション連動・モックに関する注意点**: `node --test` の引数罠（Windows/Node24）、並列ワーカー競合、ESM自動判定差、`subagents.test.js` / プリセット件数等のアサーション同期更新ルール（詳細: `@docs/testing.md`）
<!-- knowledge-kit:end section=gotchas -->

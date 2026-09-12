<!-- knowledge-kit:begin section=general-instructions version=1.12.0 -->
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
  - `sg-worker`: Single-task worker (TDD implementation without strict-goal harness tools).
  - `sg-coder`: Autonomous implementer (completes smaller goals standalone through loop).
<!-- knowledge-kit:end section=general-instructions -->

<!-- knowledge-kit:begin section=recording-rules version=1.12.0 -->
## 知見の記録ルール

**作業中に重要な知見を発見したら、ユーザーの指示を待たず自動で記録すること。**

| 種類 | 記録先 | 例 |
|---|---|---|
| また踏むバグ・罠 | `CLAUDE.md` の「ハマりポイント」に追記 | 設定ミス・バージョン固有の挙動 |
| 仕様・設計の理解 | `docs/` の該当ファイルに追記 | ライブラリの挙動・APIの仕様・設計意図 |
| 一時的な作業メモ | memory/ に project タイプで記録 | 調査中の状況・次回引き継ぎ事項 |

記録したら「〇〇をハマりポイントに追記しました」と一言報告する。
<!-- knowledge-kit:end section=recording-rules -->

<!-- knowledge-kit:begin section=gotchas version=1.12.0 -->
## ハマりポイント

<!--
書き方のルール（このコメントは残してよい）:
- 1項目 = 1箇条書き。先頭を **太字** で「何が起きるか／何に注意するか」を要約する
- 対処法・原因まで1項目内に書き切る。長くなる場合は docs/ に本文を移し、
  「（詳細: `@docs/xxx.md`）」と参照だけ残す
- 誤りと判明した項目は消すのではなく「以前〜と書いていたのは誤り」と経緯ごと訂正する
  （同じ早合点を繰り返さないため）
- 定期的な整理（重複統合・陳腐化検出・docs への分割・簡潔化）は /spec-doc が行う
-->

- （ここに知見を追記していく）
- **Git Bash の `/tmp` と Windows Python の `/tmp` は別物**: bash の `/tmp/x` を Windows Python で開くと `FileNotFoundError`（Python は `D:\tmp` を参照）。一時ファイルは scratchpad の絶対パスで統一するか、片方の環境だけで完結させる。
- **文字列置換パッチのアンカーは行末まで取る**: 短いアンカーは別節と衝突して `MATCH 2` で落ちる。置換で末尾が伸びると後から衝突することもあるため、句点を含む行末までアンカーを取ること。
- **Bash の長文ヒアドキュメントは途中切断で失敗しうる**: 数百行の日本語・コード混在を `cat >> file <<'EOF'` で流すと `unexpected EOF` になることがある。Write ツールで一時ファイルに書き `cat chunk >> target` で連結し、`grep -n '^## '` で欠落がないか確認する。
- **`grep -o 'E_[A-Z0-9_]*'` は語境界なしだと偽陽性を出す**: `XDG_STATE_HOME` を `E_HOME` として拾うため、`\bE_[A-Z][A-Z0-9_]*\b` を使うか出現箇所を1件ずつ確認すること。
- **Node 24 / Windows pwsh での `node --test` 実行引数の罠**: ディレクトリの生パス（`node --test test/` や `test`）を渡すと `MODULE_NOT_FOUND` になる。また Windows PowerShell でシングルクォートで glob（`'test/*.test.js'`）を囲むと展開されず空実行になる。引数無しの `node --test`（自動探索）か、ファイル単体パスか、ダブルクォートで glob を渡すこと。
- **`schemas/tools.json` の制約と実装の矛盾（criterion_id / weakness）**: criterion_id はアンダースコア許容（`^[a-z0-9][a-z0-9_-]{1,63}$`）が必要。また weakness の `minLength:10` は score=10 での `'none'`（4文字）を許すためスキーマからは外し、`score_submit.js` の `assertWeaknessValid()` で条件分岐検証している。
- **plan の受け入れ基準文言より `schemas/tools.json`／設計書本文を正とすること**: `rubric_amend` は `policy` フィールドを受け付けず `E_THRESHOLD_IMMUTABLE` には到達不能。また変更理由のフィールド名は `change_note` ではなく `reason`（minLength:40）。
- **Windows 環境で `node --test` が稀に rename 競合（`EPERM`）で落ちる**: 並列ワーカー間のリネーム競合による一過性フレーク。再実行してパスすれば問題ない。
- **FROZEN 差し戻し時のエラーコードは専用コード（`E_FROZEN`/`E_SUPERSEDED`）を正とする**: 地の文に `E_STATE_VIOLATION` とあっても、権威あるツール別エラー表および `src/errors/codes.js` の事前登録コードを優先すること。
- **`schemas/tools.json` の出力 `state` enum に `SUPERSEDED`/`FROZEN` が欠落**: 出力スキーマへの実行時 `validate()` は未呼び出しのため実害はないが、将来出力検証を追加する際は enum に追加すること。
- **`escalate(action: "kickback")` はペンディングトークン照合を行わない**: `kickback` は FSM 上 `FINAL` から直接呼べるためトークンが事前発行されない。スキーマの存在検査（minLength:16）のみ行い、実照合は MRTR 側の責務とする。
- **監査 JSON が要求するコミット・緩和理由は `round_store` / `rubric_diff` に永続化が必要**: レスポンス生成だけでなく、後続の監査（`audit_export`）や再検証で必要なメタデータは `rounds/<round>.commit.json` および `rubric_diff/<version>.json` に保存すること。
- **`artifact_kind: 'fileset'` のコミット・保存仕様**: fileset の `digest` は全ファイルの `"<sha256>  <path>\n"`（昇順）の sha256。`saveFilesetArtifact` により `.manifest.json` として保存され、diff は `changed_files`、`added_lines`/`removed_lines` は null となる。
- **`score_submit.js` での fileset 採点時テスト検証（R4）**: fileset で `verification === 'auto'` の基準がある場合、テストが赤なら合格点を拒否する `checkTestNotGreen` を採点時に呼び出す必要がある。
- **`escalate(action: "reopen")` は実装・配線済み**: コミット `167efbd` にて FSM 定義どおり FINAL からの再開が実装済み（`at_12.test.js` で検証）。
- **チェーンラウンド予算超過時のハンドリングと解決 (AT-16)**: `score_submit` はチェーン予算超過時、合格なら `warnings: ["chain_budget_exceeded"]` で FINAL 維持、不合格なら `verdict: "REVISE"`, `state: "ESCALATED"` へ遷移しトークンを発行する。`escalate(action: "resolve", resolution: "continue")` で `grantExtraRounds`（+6周）が付与され `DRAFTING` へ復帰する。
- **`rubric_amend` で基準を削除しても `last_evaluation.must_fix` は残る**: 直後コミットの `addresses` には、削除前の `last_evaluation.must_fix[0]` に含まれていた criterion_id を含める必要がある。
- **`score_submit` の anti-gaming 検査はスコア上昇時のみ発火し、stale が inflation/jump より先行する**: `checkEvidenceStale` / `checkScoreJump` は `currentScore <= previousScore` なら即 return する。スコアを上げて inflation や jump を単独で検証したい場合、根拠 excerpt が前周と同一だと先に `E_EVIDENCE_STALE` が飛ぶため、excerpt を新しい文に変えて stale を回避すること。
- **1周で3点超のスコア改善は `exit_code: 0` の command 根拠が2件以上必須**: `checkScoreJump` により、急激な加点には終了コード 0 の command 根拠が要求される。
- **`kickback` の予算超過エラー形式と事前状態**: `assertKickbackBudget` は `count`/`limit` を返す。また `kickback` は `FINAL` からのみ呼べるため、連続キックバックの検証は毎回 rebase→再finalize が必要。
- **上流セッション消失時の縮退分岐は `checkSupersede` の手前で即エラーになる**: 上流ディレクトリが存在しない場合、`loop_state` / `loop_open(resume)` は `E_UPSTREAM_NOT_FOUND` で停止する。
- **チェーン監査 JSON トップレベルは `schema`/`$schema` を含まない**: 設計書 §19.13.2 の JSON Schema 本文が権威であり、追加フィールドは許容されない。
- **`score_submit` でのラウンドインクリメント順序**: `session.round += 1` より前に `const scoredRound = session.round;` を確定させないと、記録される `last_evaluation.round` がずれて次周の比較が壊れる。
- **`score_submit` の `E_EVIDENCE_REQUIRED` はスキーマの `minItems: 1` により到達不能**: 実装上の防御チェックよりもスキーマ検証（`E_VALIDATION`）が先に発火するため、エラーカタログ登録対象外。
- **`normalizeForMatch` は改行を除去・畳み込みしない**: locator 根拠の `excerpt` は、本文中の改行を挟まない1文単位で切り出して指定すること（連結しない）。
- **plan モードの成果物は厳格な JSON 必須**: `artifact_commit.js` に plan 検証（`parsePlanContent` / `checkPlan` / `checkDesignRefs`）が結線されたため、Markdown ではなく `plan_version: 1`, `summary`, `tasks[]`, `design_refs` を含む有効な JSON 文字列を渡すこと。
- **`TOOL_ERRORS` レジストリは実装の実際の到達可能性を正とする**: 設計書の総覧表と実装にズレがある場合、各ツールの実装（`fail()` 呼び出しグラフ）を正としてレジストリを合わせること。
- **MCP サーバーには `tools/call` と `initialize` ハンドラが必須**: stdio で外部 MCP クライアント（Claude Code 等）から接続する際、これらが未登録だと `-32601` で落ちる。
- **`tools/list` の応答には `inputSchema` と `description` が必須**: `{ name }` のみだとクライアント側でツール登録されず検索ヒットしない。
- **セッション変更時は `writeSession` ではなく `persistSession` を呼ぶこと**: 状態変更時に `<data_dir>/dashboard/<session_id>.html` と `index.html` を同期生成する。循環参照防止のため `src/store/persist.js` を経由する。
- **`strict-goal implement` 着手前に必ず `loop_open` を呼ぶこと**: セッション起票（DRAFTING）前にコード編集を始めるとダッシュボードに反映されない。上流 plan は `.strict-goal/index.json` から自動解決可能。
- **fileset の `locator` 照合対象は個別ファイルではなくマニフェスト JSON である**: `excerpt` に個別ファイル本文を指定すると `E_EVIDENCE_NOT_FOUND` になる。マニフェスト文字列を指定するか、テスト検証には `kind: 'command'` を使うこと。
- **Antigravity でワークスペース切り替え時に MCP サーバープロセスが残留する罠**: 別プロジェクト（例: `gedoku-proxy`）を開いた後に本プロジェクトを開いても、Language Server が起動した既存の MCP 子プロセス（`strict-goal` 等）が常駐・再利用され、`--data-dir` が前プロジェクトのパスのままになる。ワークスペース跨ぎで MCP を使う際は前プロセスの残留に注意し、必要に応じてプロセス終了またはウィンドウ再読み込みを行うこと。
- **`loop_state` の `readHistory` が `1.commit.json` を拾って `ENOENT` で落ちる罠**: `roundsDir` を `readdirSync` して `parseInt` すると、`artifact_commit` で作られる `<round>.commit.json` も数値変換されて `<round>.json`（`score_submit` で作られるファイル）を読もうとし `ENOENT` になる。ファイル名が `/^\d+\.json$/` に完全一致するかフィルタする必要がある。
<!-- knowledge-kit:end section=gotchas -->

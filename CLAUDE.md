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
- 対処法・原因まで1項目内に書き切る。長くなる場合は docs/ に本文を移し、「（詳細: @docs/xxx.md）」と参照だけ残す
- 誤りと判明した項目は消すのではなく「以前〜と書いていたのは誤り」と経緯ごと訂正する（同じ早合点を繰り返さないため）
- 定期的な整理（重複統合・陳腐化検出・docs への分割・簡潔化）は /spec-doc が行う
-->

- （ここに知見を追記していく）
- **Git Bash の `/tmp` と Windows Python の `/tmp` は別物**: bash の `/tmp/x` を Windows Python で開くと `FileNotFoundError`（Python は `D:\tmp` を参照）。一時ファイルは scratchpad の絶対パスで統一するか、片方の環境だけで完結させること。
- **文字列置換パッチのアンカーは行末まで取る**: 短いアンカーは別節と衝突して `MATCH 2` で落ちる。置換で末尾が伸びると後から衝突することもあるため、句点を含む行末までアンカーを取ること。
- **Bash の長文ヒアドキュメントは途中切断で失敗しうる**: 数百行の日本語・コード混在を `cat >> file <<'EOF'` で流すと `unexpected EOF` になることがある。Write ツールで一時ファイルに書き `cat chunk >> target` で連結し、`grep -n '^## '` で欠落がないか確認すること。
- **`grep -o 'E_[A-Z0-9_]*'` は語境界なしだと偽陽性を出す**: `XDG_STATE_HOME` を `E_HOME` として拾うため、`\bE_[A-Z][A-Z0-9_]*\b` を使うか出現箇所を1件ずつ確認すること。
- **Node 24 / Windows pwsh での `node --test` 実行引数の罠**: ディレクトリの生パス（`node --test test/`）は `MODULE_NOT_FOUND` になる。また Windows PowerShell でシングルクォートで glob（`'test/*.test.js'`）を囲むと展開されず空実行になる。引数無しの `node --test`（自動探索）か、ファイル単体パスか、ダブルクォートで glob を渡すこと。
- **Windows 環境で `node --test` が稀に rename 競合（`EPERM`）で落ちる**: 並列ワーカー間のリネーム競合による一過性フレーク。再実行してパスすれば問題ない。
- **FROZEN 差し戻し時のエラーコードは専用コード（`E_FROZEN`/`E_SUPERSEDED`）を正とする**: 地の文に `E_STATE_VIOLATION` とあっても、権威あるツール別エラー表および `src/errors/codes.js` の事前登録コードを優先すること。
- **`score_submit` の anti-gaming 検査はスコア上昇時のみ発火し、stale が inflation/jump より先行する**: `checkEvidenceStale` / `checkScoreJump` は `currentScore <= previousScore` なら即 return する。スコアを上げて inflation や jump を単独で検証したい場合、根拠 excerpt が前周と同一だと先に `E_EVIDENCE_STALE` が飛ぶため、excerpt を新しい文に変えて stale を回避すること。
- **1周で3点超のスコア改善は `exit_code: 0` の command 根拠が2件以上必須**: `checkScoreJump` により、急激な加点には終了コード 0 の command 根拠が要求される。
- **`strict-goal implement` 着手前に必ず `loop_open` を呼ぶこと**: セッション起票（DRAFTING）前にコード編集を始めるとダッシュボードに反映されない。上流 plan は `.strict-goal/index.json` から自動解決可能。
- **Antigravity でワークスペース切り替え時に MCP サーバープロセスが残留する罠（恒久対策済み）**: 別プロジェクトを開いた後に本プロジェクトを開くと、IDE基盤が既存の MCP 子プロセスを再利用し起動引数 `--data-dir` が前プロジェクトのままになることがある。`loop_open` 時に `workspace_dir` を渡すことで、`session_registry.js` が自ワークスペースの `.strict-goal/` 配下に自動ルーティングして恒久解決された。後続のツールもセッションIDから自動解決される。
- **`.gitignore` の `.agents/agents/` は新規サブエージェント md を丸ごと隠す罠**: `.claude/agents/` にファイルを足しても `.agents/agents/` ミラーへ `git add -f` し忘れると CI だけ `E_ENOENT` 級の存在検査で落ちる。新規 `sg-*.md` 追加時は両ミラー＋git追跡を確認すること。
- **CI(Linux/Node22)と手元(Windows/Node24)で `node --test <一時ファイル>` の ESM 自動判定挙動が違う**: 一時ディレクトリに `package.json` が無いテストファイルは、Node24だと構文検出で ESM 再解釈されるが、Node22では効かず0テスト実行のまま成功扱いになることがある。テスト用一時ディレクトリには `{"type":"module"}` の `package.json` を明示配置すること。
- **`subagents.test.js` はエージェントプロンプトの `helper.js` 言及を必須パターンとしてアサートする**: サブエージェント（`sg-implementer`, `sg-coder` 等）のプロンプト定義を改定する際、テスト実行やマニフェスト計算の言及として `helper.js` を削るとアサーションエラーになる。必ず言及を残すこと。
- **`rubric_preset` の汎用設計（`design`: 8基準）とハーネス設計（`design.harness`: 17基準）の使い分け**: 以前は `design` がハーネス専用15基準だったが、汎用クラス設計等でスコープ外記述（配布・運用・自己適用等）を強いられる問題に対処するため分離。汎用タスクは `design`（8基準）、ハーネス・エージェント基盤は `design.harness`（17基準）を自律選択する。
- **散文の「優先順位」は効かないが、`criterion.priority`（0〜3）で `buildMustFix` がソートされる**: 判定は全基準9点以上の最小値ゲートだが、基準に `priority` を設定することで `buildMustFix` が priority 降順・スコア昇順でソートされ、重要課題が優先提示される。
- **`design` モードのルーブリックには `verification:"auto"` 基準が存在する**: `interface_completeness`, `defaults_decided` 等は `verification:"auto"` であり、`score_submit` 時に `command` 根拠が最低1件添付されていないと `E_EVIDENCE_KIND` で拒絶される。locator のみでは通らないため、コマンド根拠を付与すること。
- **ベンチマークでのツール禁止はプロンプト縛りではなくサンドボックス設定で物理遮断すること**: プロンプトに禁止事項を書くと `cat` 等で読んだ際に文字列が現れ誤失格を招く。ツール遮断は空の `.codex/config.toml` や `--strict-mcp-config` 等で物理的に提供しないこと。
- **プリセット基準数やポリシーの改訂は `presets.test.js` などの既存件数アサーションと直接連動する**: `presets/design.json` などの基準数・基準ID・ポリシー値を変更すると、`test/presets.test.js` や `test/defaults_table.test.js` にある厳密な基準数・スナップショット照合が失敗するため、テスト側も同期更新すること。
- **ホスト標準のスラッシュコマンドと同名のスキル（`skills/goal`）を置くと、ホスト機能が strict-goal にハイジャックされる罠**: Antigravity や Claude Code 等はプロジェクト内スキルを優先読み込みするため、`goal` スキルを置くと標準の `/goal` コマンドが奪われる。起動は `/strict-goal` や `strict-goal` プレフィックスに限定し、標準コマンドと競合する名前のスキル定義は避けること。
- **MCPツール追加時はテスト側件数（7→8）と固定順序配列の同期更新が必須**: `tools_list.js` や `schemas/tools.json` に新ツール（`invoke_subagent` 等）を追加した際、`test/tools_list.test.js`, `test/schema_validate.test.js`, `test/defaults_table.test.js` にあるツール数固定アサーション（7本）および固定順序配列も同期更新すること。
- **CI環境で外部CLI（agy/claude/codex）不在時の invoke_subagent テストは一時モックで隔離する**: GitHub Actions等のクリーンなrunnerには各エージェントCLIが存在しないため、`invoke_subagent` は `E_RUNNER_NOT_FOUND` を投げる。テストでは一時ディレクトリにモックスクリプトを配置してPATH先頭に追加することで正常系を検証可能。
- **シェルスクリプトは .gitattributes で `*.sh text eol=lf` を明示しWindowsでのCRLF変換を防ぐ**: Windows環境でチェックアウト・編集されたシェルスクリプトにCRLF（`^M`）が混入すると、Linux/WSL上で実行時に `set: pipefail: invalid option name` や構文エラーで即時異常終了する。
- **階層サブエージェント実行時のクライアント別探索パスの注意点**: サブエージェント定義は Claude Code が `.claude/agents/`、Codex が `.codex/agents/*.toml`、Antigravity が `.agents/agents/` を参照する。環境ごとに適切なディレクトリへ配置・追跡する必要がある（詳細: `@docs/design-quantitative-evaluation.md`）。
- **Claude Code のセッション jsonl は content ブロックごとに同一 usage を複写するため `message.id` で重複排除すること**: 行単位で合計すると 2〜3 倍に過大計上される。サブエージェント消費は `<session>/subagents/agent-*.jsonl` に別置きされるため別途合算が必要。
- **エージェント実行時のサンドボックスは親ディレクトリ遡りによる CLAUDE.md 汚染を防ぐためリポジトリ外に配置すること**: サンドボックスをリポジトリ内に置くとエージェントが親を遡って開発用 `CLAUDE.md` を読み込み方針が汚染される。サンドボックスはリポジトリ外（一時ディレクトリ等）に配置すること。
<!-- knowledge-kit:end section=gotchas -->

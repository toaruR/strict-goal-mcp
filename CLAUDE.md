<!-- knowledge-kit:begin section=general-instructions version=1.10.10 -->
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
<!-- knowledge-kit:end section=general-instructions -->

<!-- knowledge-kit:begin section=recording-rules version=1.10.10 -->
## 知見の記録ルール

**作業中に重要な知見を発見したら、ユーザーの指示を待たず自動で記録すること。**

| 種類 | 記録先 | 例 |
|---|---|---|
| また踏むバグ・罠 | `CLAUDE.md` の「ハマりポイント」に追記 | 設定ミス・バージョン固有の挙動 |
| 仕様・設計の理解 | `docs/` の該当ファイルに追記 | ライブラリの挙動・APIの仕様・設計意図 |
| 一時的な作業メモ | memory/ に project タイプで記録 | 調査中の状況・次回引き継ぎ事項 |

記録したら「〇〇をハマりポイントに追記しました」と一言報告する。
<!-- knowledge-kit:end section=recording-rules -->

<!-- knowledge-kit:begin section=gotchas version=1.10.10 -->
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
- **Git Bash の `/tmp` と Windows Python の `/tmp` は別物**: bash のヒアドキュメントで `/tmp/x` に書いたファイルを `python -c "open('/tmp/x')"` で読むと `FileNotFoundError`（bash は msys の /tmp、Python はカレントドライブ直下の `D:\tmp` を見る）。一時ファイルは scratchpad の絶対パスで統一するか、bash と Python のどちらか一方だけで完結させる。
- **文字列置換パッチのアンカーは前方一致で二重マッチする**: `"**エラー条件**: \`E_SESSION_NOT_FOUND\` / \`E_INTERNAL\`"` のような短いアンカーは、同じ書き出しの別節にも当たって `MATCH 2` で落ちる。しかも**先に別の置換で末尾を伸ばした結果あとから衝突する**ので、置換順に依存する。アンカーは行末まで（句点込みで）取る。
- **Bash の長文ヒアドキュメントは失敗しうる**: 数百行規模の日本語＋コードフェンス混在ブロックを `cat >> file <<'EOF'` で流すと `unexpected EOF while looking for matching` で落ちることがある（原因は入力の途中切断で、引用符やクォート形式の問題ではない）。回避策は Write ツールで scratchpad にチャンクを書き、`cat chunk >> target` で連結する。連結後は `grep -n '^## '` で節が全部入ったか必ず確認する（1チャンク取りこぼしても静かに成功するため）。
<!-- knowledge-kit:end section=gotchas -->
- **`grep -o 'E_[A-Z0-9_]*'` はエラーコード列挙で偽陽性を出す**: 設計書のエラーコードを数えるとき、この正規表現は `XDG_STATE_HOME` を `E_HOME`、`CLAUDE_PLUGIN_DATA` を `E_PLUGIN_DATA`、`CLAUDE_PLUGIN_ROOT` を `E_PLUGIN_ROOT` として拾う（部分一致するため）。45件出て「設計書の42件と合わない」となる。`\bE_[A-Z][A-Z0-9_]*\b` のように語境界を付けるか、拾った候補を1件ずつ `grep -n` で出現箇所確認すること。
- **`node --test test/`（末尾スラッシュ付きディレクトリ）は Node 24 で `MODULE_NOT_FOUND` になる**: ディレクトリを渡したいなら `node --test` だけで実行する（`test/` 配下を自動探索する）か `node --test 'test/*.test.js'` のようにグロブを渡す。末尾スラッシュ付きの生パスは CommonJS require 解決に落ちて壊れる。
- **T012 で抽出した `schemas/tools.json` の `score_submit.scores[].criterion_id` パターンと `weakness` の制約が設計書と矛盾していた**: (1) パターンが `^[a-z0-9][a-z0-9-]{1,63}$`（ハイフンのみ）になっていたが、実際の rubric preset（`presets/design.json` の `failure_mode_mapping` 等）や `rubric/schema.js` の criterion id はアンダースコアを使う。`^[a-z0-9][a-z0-9_-]{1,63}$` に修正（T035）。(2) `weakness` に `minLength:10` が付いていたが、設計書は「score=10 のときのみ `'none'`（4文字）を許す」としており矛盾。共有 `validate()` は oneOf/条件分岐を持たないため、スキーマ側の `minLength` は外し、`assertWeaknessValid()`（`score_submit.js`）で「`'none'` なら score===10 必須、それ以外は手動で `WEAKNESS_MIN_LENGTH` 以上を要求」を実装した。設計書の schema 例をそのまま抽出するだけでは通らないケースがある（T028/T031 の「$schema 等の未サポートキーを削る」だけでなく、値レベルの制約矛盾もチェックが要る）。
- **T039 の plan 記述（実装計画の受け入れ基準）が実際の `schemas/tools.json`（設計書§6.4.5から抽出）と矛盾していた**: `rubric_amend` の入力スキーマは `additionalProperties:false` で `policy` フィールドを一切受け付けない（常に前版の policy を継承する仕様）。設計書自身のエラー条件表も「`E_THRESHOLD_IMMUTABLE` はこの経路では構造的に到達不能」と明記している。にもかかわらず plan の T039 受け入れ基準は「pass_score の変更が E_THRESHOLD_IMMUTABLE になること」「change_note が19文字で E_VALIDATION、20文字で通ること」と書いており、(a) 存在しない到達パスを前提にし、(b) 実際のフィールド名は `change_note` ではなく `reason`（minLength:40、`artifact_commit` の `change_note` と混同したコピペミスと思われる）。plan の受け入れ基準文言より `schemas/tools.json`／設計書本文を正とすること。
- **Windows 環境で `node --test 'test/*.test.js'` が稀に `EPERM`/`errno:-4048`/`syscall:'rename'`（`atomic.js` の `writeAtomic` 内）で落ちることがある**: 並列実行される `node:test` ワーカー間のファイルリネーム競合と見られる一過性のフレーク。コード変更なしに同じコマンドを再実行して全件パスすれば回帰ではなくフレーク。
- **設計書 §19.4（下流 FROZEN の差し戻し）本文と §6.4.3（`artifact_commit` のエラー条件表）が矛盾していた**: §19.4 の地の文は `FROZEN` 状態での `artifact_commit`/`score_submit` を `E_STATE_VIOLATION`（detail.reason:"frozen_by_kickback"）と書くが、§6.4.3 自身の権威あるツール別エラー表は `E_FROZEN`／`E_SUPERSEDED` という専用コードを明記している。`src/errors/codes.js` にも両コードが `detailKeys` 付きで事前登録済み（T012 由来）だったため、T041 では専用コードを正とし `chain/supersede.js` は `E_FROZEN`/`E_SUPERSEDED` を投げる実装にした。地の文より各ツールの権威あるエラー表・`codes.js` の事前登録を優先すること。
- **`schemas/tools.json` の出力スキーマの `state` enum が `SUPERSEDED`/`FROZEN` を含んでいない**（`loop_open`/`loop_state`/`artifact_commit`/`score_submit`/`escalate` いずれの output.state enum も9状態中この2つが欠落。T012 時点の設計書抜粋がこの2状態を追加する前の版だった可能性）。ただし出力は実行時に `validate()` で検査されていない（`src/**` に output スキーマへの `validate()` 呼び出しは無い）ため実害は今のところ無いが、将来 output 検証を追加するタスクや schema 準拠テストを書くタスクは先にこの2状態を enum に足すこと。
- **T043 の `escalate(action:"kickback")` は `human_token` を実トークンと照合できない**: `human_token` の唯一の発行元は `escalation/token.js` の `createEscalation`（`request_human` で ESCALATED になったときだけ書かれる）。しかし `kickback` は FSM 上 `FINAL`/`FINAL_WITH_RELAXATION` から直接呼べる（`fsm/states.js` の `escalateOnly(['reopen','kickback'])`）一方、`FINAL` は `request_human` を許可しない（`escalateOnly` に含まれない）ため、その経路では絶対にペンディングトークンが存在しない。設計書 §14.3.2 A10「`human_token` は速度制限でありセキュリティ境界ではない」とも整合するので、`kickback` では `consumeToken()` を呼ばずスキーマの存在検査（`assertActionInputs`, minLength:16）だけで通す実装にした。実トークンとの照合は T044（MRTR）側の責務として先送りしている。
- **T045（`audit_export`）で、監査 JSON が要求する周ごとのメタデータがそれまでどこにも永続化されていなかった**: `artifact_commit` の入力（`change_note` / `addresses`）と算出した `diff` / `previous_digest` は、レスポンス（`buildEnvelope`）にしか現れず、`session.current_artifact` には `digest`/`bytes`/`committed_at` しか残らない。`rubric_amend` の入力 `reason`（minLength:40 必須）も `rubric_diff/<version>.json`（`saveRubricDiff`）に保存されていなかった。設計書 §12.2 の監査実例はこの両方を要求するため、T045 で `judge/round_store.js` に `rounds/<round>.commit.json`（`recordCommitForRound`/`readCommitForRound`）を追加し、`rubric/diff.js` の `saveRubricDiff` に `reason` を含めるよう拡張した。既存タスクが「レスポンスに出せば実装完了」で終わらせがちな箇所ほど、後続の監査/再検証タスクで永続化漏れが露見しやすい。
- **`artifact_commit` は `loop_mode:"implement"`（`artifact_kind:"fileset"`）の `files` 入力を今も `E_VALIDATION`（`reason:"not_implemented"`）で拒否するスタブのまま**: T031 は `artifact/fileset.js` のマニフェスト検証ロジックと `fileset.test.js`（単体テスト）だけを追加し、`artifact_commit.js` 本体には結線していない（コード内コメント「fileset は T031 で実装する」は T031 完了後も更新されていない）。そのため `design→plan→implement` の3セッション連鎖を公開ツール経由で最後まで `FINAL` にすることは現状不可能。T046（`audit_export` chain scope）のテストは `design→plan` の2セッション連鎖＋`kickback`/`rebase` で代替し、3モードの並び順は `MODE_ORDER` によるソートで論理的に保証するに留めた。implement を含む結合テストを書くタスクは、先に `artifact_commit.js` への fileset 結線が必要。
- **`docs/design-rubric-loop-mcp.md` §19.13.2 のチェーン監査 JSON トップレベルは `additionalProperties:false` で `schema`/`$schema` キーを含まない**（セッション単位監査 v1 が持つ `schema` フィールドと非対称）。`rubric-loop-agy/`（未追跡の並行実装、T046 着手時に既に存在していた別実装。由来不明で本タスクの参照専用に留めた）はここに `schema`/`$schema` の両方を追加しており、この設計書のスキーマ定義に照らすと不適合。`rubric-loop/`（本実装）側の `chain_v2.js` は追加していない。設計書の JSON Schema 本文（`$id`/`required`/`properties`）が権威であり、他の実装や地の文の例（§19.13.3 など）はそれに従わせること。

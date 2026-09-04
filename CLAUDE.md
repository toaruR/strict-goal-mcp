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

# テストガイドラインとハマりポイント

本書は、本リポジトリにおけるテスト実行環境（Windows / Linux CI / Node.js 22 & 24）、単体テスト作成、および既存テストとのアサーション連動に関する知見と注意事項をまとめたものです。

---

## 1. テストの実行方法と環境差

### Node 24 / Windows pwsh での `node --test` 実行引数の罠
- **症状**: ディレクトリの生パス（`node --test test/`）を指定すると `MODULE_NOT_FOUND` になる。また Windows PowerShell でシングルクォートで glob（`'test/*.test.js'`）を囲むと展開されず空実行（0 tests run）になる。
- **対処法**:
  - 引数無しの `npm test` または `node --test`（自動探索）を使用する。
  - ファイルを単体指定する場合は `node --test test/foo.test.js` のようにパスを渡す。
  - glob を渡す場合はダブルクォートで囲む（`node --test "test/*.test.js"`）。

### Windows 環境での rename 競合（`EPERM`）フレーク
- **症状**: Windows 環境で並列テストワーカー（`node --test`）を実行した際、一時ディレクトリのリネーム等で稀に `EPERM` が発生して落ちることがある。
- **対処法**: 並列ワーカー間のリネーム競合による一過性のフレーク。再実行してパスすれば問題ない。

### CI (Linux / Node 22) と手元 (Windows / Node 24) の ESM 自動判定差
- **症状**: テスト内で動的に作成した一時ディレクトリに `package.json` が無い場合、Node 24 では構文検出により ESM として再解釈されて動くが、Node 22 では適用されず 0 テスト実行のまま成功扱い（偽陽性）になることがある。
- **対処法**: テスト用一時ディレクトリには `{"type":"module"}` を持つ `package.json` を明示配置すること。

---

## 2. 単体テスト作成とモック・隔離

### CI 環境で外部 CLI (agy / claude / codex) 不在時のモック隔離
- **症状**: GitHub Actions 等のクリーンな runner には各エージェント CLI が存在しないため、`invoke_subagent` は `E_RUNNER_NOT_FOUND` を投げてテストが失敗する。
- **対処法**: テスト実行時に一時ディレクトリへモックスクリプト（Windows: `.cmd`、Linux: 実行権限付きシェルスクリプト）を作成し、`PATH` の先頭に追加して隔離・実行すること。

---

## 3. 既存テストのアサーション連動ルール

リポジトリ内のコードやプロンプトを変更する際、以下のテストが固定件数やキーワードをアサートしているため同期更新が必要となる。

### 1. `subagents.test.js` での `helper.js` 言及アサーション
- サブエージェント（`sg-implementer`, `sg-coder` 等）のプロンプト定義（`.agents/agents/*.md`, `.claude/agents/*.md`）を改定する際、テスト実行やマニフェスト計算の言及として `helper.js` を削るとアサーションエラーになる。言及を残すこと。

### 2. プリセット基準数・ポリシー改訂と `presets.test.js` 連動
- `presets/design.json` などの基準数・基準 ID・ポリシー値を変更すると、`test/presets.test.js` や `test/defaults_table.test.js` にある厳密な基準数・スナップショット照合が失敗する。テスト側の件数・スナップショットも同期更新すること。

### 3. MCP ツール追加時のツール数アサーション
- `tools_list.js` や `schemas/tools.json` に新ツールを追加した際、`test/tools_list.test.js`, `test/schema_validate.test.js`, `test/defaults_table.test.js` にあるツール数固定アサーション（8本）および固定順序配列も同期更新すること。

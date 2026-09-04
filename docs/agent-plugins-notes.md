# Agent Plugins 1.0.0 メモ（外部仕様）

出典: https://agent-plugins.org/ （specification / plugin-authors/mcp-servers / client-implementers/conformance / compatible-clients）

## 形式
- コンポーネントは **skills/ と mcp.json の2種のみ**。固定位置でしか発見されない。位置が無いのは「有効な不在」でエラーではない。
- `plugin.json` は closed schema。必須は `$schema` と `name`。未知の最上位フィールドは報告のうえ無視。
- `plugin.json` と `mcp.json` の Agent Plugins バージョンは一致必須。

## mcp.json
- 最上位キーは `$schema` と `mcpServers` のみ。
- transport: `stdio`（`type`,`command` 必須）/ `streamable-http`（`type`,`url`）/ `sse`（legacy、クライアント実装は任意）。
- クライアントは stdio か streamable-http の**最低1つ**を実装。宣言した transport で初回接続し、**フォールバック経路は仕様に無い**。
- `command` は**単一実行トークン**（シェル文字列不可）。bare name か `./` 始まりのプラグイン相対パス。command 内は変数展開されない。
- 変数は `PLUGIN_ROOT`（絶対パスのプラグインルート）と `PLUGIN_DATA`（更新をまたいで永続する書き込み可能ディレクトリ）の2つだけ。展開は `args` / `env` の値 / `cwd` のみ、単一パス非再帰。env のキー・URL・ヘッダには効かない。
- `cwd` 既定はプラグインルート。指定時も PLUGIN_ROOT / PLUGIN_DATA 配下から出られない。
- リモートURLは絶対 http/https、userinfo・fragment 不可、loopback 以外は HTTPS 必須。ヘッダはリテラルなので**資格情報を入れない**（1.0.0 に可搬な認証機構は無い）。

## 障害境界
- コンポーネント個別の失敗は非致命。MCPサーバが1つ落ちても skills や他サーバのロードは止まらない。

## 対応クライアント（2026-08 時点の掲載）
VS Code / Cursor / GitHub Copilot / ChatGPT & Codex / Kiro / Hermes Agent / OpenClaw / Grok Bot / NanoClaw。
いずれも Agent Skills + MCP に対応。transport は全て stdio + Streamable HTTP、legacy SSE は一部のみ（Codex・Hermes・NanoClaw は無し）。
**Claude Code は一覧に無い**（独自プラグイン形式。`${CLAUDE_PLUGIN_ROOT}` は `PLUGIN_ROOT` のベンダー別名）。

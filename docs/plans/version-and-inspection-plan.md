# strict-goal バージョン管理および確認機能の導入計画

strict-goal に単一情報源となるバージョン管理（`1.0.0`）を導入し、CLI・helper・MCPハンドシェイク・セッションメタデータからバージョンを確認可能にする。
本タスクはユーザー指示に基づき、strict-goal の3段階連鎖パイプライン（`design` → `plan` → `implement`）に沿って厳格なルーブリック検証を経て遂行する。

## 概要と目標
- strict-goal に単一情報源となるバージョン（`1.0.0`）を定義。
- CLI (`main.js --version`, `-v`)、helper (`helper.js version`, `--version`, `-v`)、MCP プロトコル (`initialize`, `server/discover`)、セッション情報 (`session.server.version`) による確認手段を提供。
- 全テストの通過、ドキュメント・スキル整備、および strict-goal ハーネス（`design` → `plan` → `implement`）による完全検証。

## 変更対象コンポーネント

### 1. バージョン単一情報源
- `strict-goal/server/src/version.js` (NEW): `VERSION = '1.0.0'` および `NAME = 'strict-goal'`

### 2. CLI 確認
- `strict-goal/server/main.js` (MODIFY): `--version` / `-v` 対応
- `strict-goal/server/helper.js` (MODIFY): `version` / `--version` / `-v` 対応

### 3. MCP プロトコル・セッション情報
- `strict-goal/server/src/mcp/initialize.js` (MODIFY): `VERSION` 参照
- `strict-goal/server/src/mcp/discover.js` (MODIFY): `VERSION` 参照
- `strict-goal/server/src/tools/loop_open_create.js` (MODIFY): `session.server.version` 記録

### 4. テスト・ドキュメント
- `strict-goal/server/test/version.test.js` (NEW): CLI/MCP/セッションの網羅的テスト
- `docs/specification.md` (MODIFY): バージョン確認仕様
- `README.md` / `README.ja.md` (MODIFY): CLI 記述
- `.agents/skills/strict-goal/SKILL.md` (MODIFY): 利用方法

## 検証方針
- `node --test`
- `main.js --version` / `helper.js version`
- strict-goal 各フェーズ (`design` → `plan` → `implement`) でのサーバー FINAL 判定取得

# strict-goal バージョン管理およびバージョン確認仕様書

## 1. 概要と目的
本仕様書は、`strict-goal` ハーネスシステムにおいてバージョン（初期値: `1.0.0`）を単一情報源（Single Source of Truth）として集約し、人間・エージェント・MCPクライアントの双方が一貫した方法でバージョンを確認できるようにするためのアーキテクチャおよび外部インタフェースを定義する。

---

## 2. 失敗モード対応表 (failure_mode_mapping)

| 失敗モードID | 失敗モードの内容 | 発生原因 | 対応する防御機構 (1対1) |
|---|---|---|---|
| FM-01 | CLI `--version` / `-v` 実行時にプロセスがハングまたはエラーになる | `main.js` が引数を適切に処理せず stdio 待機に入る | `parseArgs` で `--version` / `-v` を先頭で検出し、バージョン文字列を出力して `process.exit(0)` する |
| FM-02 | スクリプトやエージェントから軽量にバージョン確認する手段がない | `helper.js` にバージョン照会コマンドが存在しない | `helper.js` に `version`, `--version`, `-v` サブコマンドを追加し標準出力に出力して正常終了する |
| FM-03 | MCPクライアントがハンドシェイク時に古いまたは不一致なバージョンを受け取る | `initialize.js` と `discover.js` にハードコードされた文字列が存在する | `src/version.js` から共通の定数をインポートして返却する |
| FM-04 | 複数ファイルでバージョン定義が乖離しメンテナンス不能になる | ファイルごとに手動でバージョンを書き換えている | `src/version.js` を実行時の単一情報源とし、各モジュールがここから参照する |
| FM-05 | 監査ログやセッション記録から実行サーバーのバージョンが追跡できない | `session.json` の `server` オブジェクトにバージョンが含まれていない | `loop_open_create.js` で `session.server.version = VERSION` を記録する |

---

## 3. 外部インタフェース仕様 (interface_completeness)

### 3.1 CLI インタフェース (`main.js`)
- **コマンド**: `node strict-goal/server/main.js [--version | -v]`
- **入力引数**:
  - `--version`: バージョン表示フラグ
  - `-v`: バージョン表示短縮フラグ
- **出力形式**: 標準出力にプレーンテキスト `strict-goal 1.0.0\n`
- **終了コード**:
  - 成功時: `0`
- **エラー条件**:
  - 未知のオプションが渡された場合（`--data-dir` 以外）は stdio サーバーを起動

### 3.2 Helper CLI インタフェース (`helper.js`)
- **コマンド**: `node strict-goal/server/helper.js [version | --version | -v]`
- **入力引数**:
  - `version`, `--version`, `-v`: バージョン表示サブコマンド
- **出力形式**: 標準出力にプレーンテキスト `strict-goal 1.0.0\n`
- **終了コード**:
  - 成功時: `0`
- **ヘルプ表示 (`--help`)**: Usage 一覧に `node strict-goal/server/helper.js version` を明記

### 3.3 MCP プロトコルインタフェース (`initialize` / `server/discover`)
- **メソッド**: `initialize`
  - **入力スキーマ**:
    ```json
    {
      "type": "object",
      "properties": {
        "protocolVersion": { "type": "string" },
        "capabilities": { "type": "object" },
        "clientInfo": { "type": "object" }
      }
    }
    ```
  - **出力スキーマ**:
    ```json
    {
      "type": "object",
      "required": ["protocolVersion", "capabilities", "serverInfo"],
      "properties": {
        "protocolVersion": { "type": "string" },
        "capabilities": { "type": "object" },
        "serverInfo": {
          "type": "object",
          "required": ["name", "version"],
          "properties": {
            "name": { "type": "string", "enum": ["strict-goal"] },
            "version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" }
          }
        }
      }
    }
    ```
- **メソッド**: `server/discover`
  - **出力スキーマ**:
    ```json
    {
      "type": "object",
      "required": ["protocolVersions", "serverInfo", "capabilities"],
      "properties": {
        "protocolVersions": { "type": "array", "items": { "type": "string" } },
        "serverInfo": {
          "type": "object",
          "required": ["name", "version"],
          "properties": {
            "name": { "type": "string", "enum": ["strict-goal"] },
            "version": { "type": "string", "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$" }
          }
        },
        "capabilities": { "type": "object" }
      }
    }
    ```

### 3.4 セッション永続化メタデータ (`session.json`)
- **保存先パス**: `<data_dir>/sessions/<session_id>/session.json`
- **スキーマ拡張**:
  ```json
  {
    "server": {
      "version": "1.0.0",
      "plugin_root": "...",
      "plugin_root_source": "...",
      "data_dir": "...",
      "data_dir_source": "...",
      "persistence": "..."
    }
  }
  ```

---

## 4. 状態の外部化 (state_externalized)

| 状態項目 | 格納場所 | 復帰・確認手段 |
|---|---|---|
| サーバーバージョン | `src/version.js` (静的定義) | `main.js --version` / `helper.js version` |
| セッション作成時バージョン | `<data_dir>/sessions/<session_id>/session.json` (`server.version`) | `loop_state({ session_id })` 経由で取得 |
| セッション実行時状態 | `<data_dir>/sessions/<session_id>/session.json` | 1回の `loop_state` 呼び出しで完全復帰 |

文脈が途切れた場合は、会話履歴に依存せず `loop_state({ session_id })` を1回呼ぶだけでセッション状態を完全に復元する。

---

## 5. 判定の所有権 (verdict_ownership)
合否判定（`verdict`）の発行権威はサーバー（`score_submit.js`）のみに存在する。
モデルが指定する `self_verdict_note` は記録専用の注記であり、サーバーの判定計算式（`pass_score >= 9` かつ `weighted_mean >= 9.0`）には一切関与しない。

---

## 6. アンチゲーミング機構 (anti_gaming)

| 手口 | 検出・抑止機構 | 処理方針 |
|---|---|---|
| 成果物を更新せずにスコアを引き上げる | `checkScoreInflation` (前回成果物ダイジェストとの一致検査) | `E_SCORE_INFLATION` で提出を即時拒絶 |
| 前回と同一の根拠テキストを使い回す | `checkEvidenceStale` (根拠ハッシュ照合) | `E_EVIDENCE_STALE` で提出を即時拒絶 |
| 単一周で3点を超える大幅加点を行う | `checkScoreJump` (終了コード0のcommand根拠2件検査) | 不足時は `E_SCORE_JUMP` で提出を即時拒絶 |
| 弱点申告をごまかす | `assertWeaknessValid` (10点未満での 'none' 申告検査) | `E_WEAKNESS_REQUIRED` で提出を即時拒絶 |

---

## 7. 有限状態機械とツール制約 (state_machine)

| 状態 (`state`) | `loop_open` | `loop_state` | `artifact_commit` | `score_submit` | `rubric_amend` | `escalate` | `audit_export` |
|---|---|---|---|---|---|---|---|
| `INIT` | ○ | ○ | × | × | × | × | × |
| `DRAFTING` | ○ | ○ | ○ | × | ○ | ○ | ○ |
| `SCORING` | ○ | ○ | × | ○ | × | ○ | ○ |
| `FINAL` | ○ | ○ | × | × | × | ○ (kickback/reopen) | ○ |
| `STALLED` | ○ | ○ | × | × | × | ○ | ○ |
| `ESCALATED` | ○ | ○ | × | × | × | ○ | ○ |
| `SUPERSEDED`| ○ | ○ | × | × | × | ○ (rebase) | ○ |
| `FROZEN` | ○ | ○ | × | × | × | ○ | ○ |
| `ABORTED` | ○ | ○ | × | × | × | × | ○ |

---

## 8. 収束条件と打ち切り条件 (convergence)
- **合格条件**: 全基準で `score >= 9` かつ 加重平均 `weighted_mean >= 9.0`。満たせばサーバーが `FINAL` を発行。
- **停滞条件**: スコア改善幅が `stall_epsilon = 0.25` 未満の周が `stall_window = 3` 周連続した場合、`STALLED` へ遷移。
- **最大周回数**: `max_rounds = 12` に達した場合、自動的に `STALLED` へ遷移。
- **出口**: `STALLED` に陥った場合は `escalate` ツール経由でのみ救済・終了可能。

---

## 9. 配布パッケージ仕様適合 (packaging_conformance)

配布パッケージは Agent Plugins 1.0.0 および MCP サーバー仕様に準拠する:
- `strict-goal/plugin.json`:
  ```json
  {
    "$schema": "https://agent-plugins.org/schemas/v1.0.0/plugin.json",
    "name": "strict-goal",
    "version": "1.0.0",
    "description": "AIの妥協やサボりを防ぎ、客観的なルーブリック検証を満たすまで厳格にゴール完遂を強制する MCP サーバとスキル",
    "license": "MIT"
  }
  ```
- `strict-goal/server/package.json`:
  ```json
  {
    "name": "strict-goal-server",
    "version": "1.0.0",
    "private": true,
    "type": "module"
  }
  ```
- `src/version.js`:
  ```javascript
  export const VERSION = '1.0.0';
  export const NAME = 'strict-goal';
  ```

---

## 10. ホスト可搬性方針 (host_portability)
- パス区切り文字: Windows (`\`) と UNIX (`/`) の差異を `path.resolve` および `normalizePath` で吸収。
- CLI 実行: `node strict-goal/server/main.js --version` は POSIX sh / Windows cmd / PowerShell の全環境で終了コード 0 を返却。
- 外部依存: Node.js 組み込みモジュール（`node:fs`, `node:path`, `node:child_process`）のみを使用し、ネイティブ依存や npm インストールを一切不要とする。

---

## 11. 責務分割表 (responsibility_split)

| 責務 | 担当主体 | 理由 |
|---|---|---|
| バージョン定数の保持 | `src/version.js` | 実行時コードにおける単一の情報源 |
| CLI バージョン表示 | `main.js`, `helper.js` | ユーザーおよびシェルからの直接実行窓口 |
| MCP 初期化応答 | `initialize.js`, `discover.js` | プロトコルネゴシエーションの責務 |
| セッション記録 | `loop_open_create.js` | セッションライフサイクルの管理責務 |
| 合否・ルーブリック判定 | strict-goal サーバー | 不正・自己評価バイアスを排除する独立検証機関 |
| 成果物執筆・自己採点 | AI エージェント（モデル） | 開発作業者としての責務 |

---

## 12. 監査可能性 (auditability)
- 提出された全コミット、採点、根拠、ダイジェスト、タイムスタンプは `<data_dir>/sessions/<session_id>/rounds/` 配下に保存。
- 拒否された提出も `rounds/<round>.rejected/<n>.json` にエラーコード付きで保存。
- `audit_export` ツールにより、外部監査可能な標準 JSON 形式で全履歴を出力可能。

---

## 13. 受け入れテストシナリオ (acceptance_tests)

### シナリオ 1: `main.js --version` および `-v`
- 実行: `node strict-goal/server/main.js --version`
- 期待値: 標準出力に `strict-goal 1.0.0`、終了コード `0`。
- 実行: `node strict-goal/server/main.js -v`
- 期待値: 標準出力に `strict-goal 1.0.0`、終了コード `0`。

### シナリオ 2: `helper.js version`, `--version`, `-v`
- 実行: `node strict-goal/server/helper.js version`
- 期待値: 標準出力に `strict-goal 1.0.0`、終了コード `0`。
- 実行: `node strict-goal/server/helper.js --version`
- 期待値: 標準出力に `strict-goal 1.0.0`、終了コード `0`。

### シナリオ 3: `initialize` / `discover` MCP ハンドラ
- 実行: `handleInitialize()`
- 期待値: `result.serverInfo.version === '1.0.0'` かつ `result.serverInfo.name === 'strict-goal'`。
- 実行: `handleDiscover()`
- 期待値: `result.serverInfo.version === '1.0.0'` かつ `result.serverInfo.name === 'strict-goal'`。

### シナリオ 4: セッション記録
- 実行: `loop_open({ mode: 'create', loop_mode: 'design', task: '...' })`
- 期待値: 生成された `session.json` の `server.version === '1.0.0'`。

---

## 14. 既定値一覧表 (defaults_decided)

| 設定キー | 既定値 | 設定理由 |
|---|---|---|
| `VERSION` | `"1.0.0"` | セマンティックバージョニング初期安定版 |
| `NAME` | `"strict-goal"` | パッケージマニフェスト名と一致 |
| CLI `--version` 出力フォーマット | `strict-goal 1.0.0\n` | UNIX 標準の `<name> <version>` 形式 |
| `helper.js version` 出力フォーマット | `strict-goal 1.0.0\n` | CLI との出力統一 |
| CLI 正常終了コード | `0` | 標準的なプロセス正常終了 |
| `session.server.version` | `"1.0.0"` | 追跡性のためのセッションメタデータ保存 |

全ての既定値は値つきで決定されており、未決定項目は存在しない。

---

## 15. 自己適用追跡 (self_hosting)
本機能の開発自身を `strict-goal` の 3 段階連鎖パイプラインに適用する:
1. **Design フェーズ (`loop_mode: "design"`)**:
   - 本仕様書（`docs/version-specification.md`）を作成し、ルーブリック検証を行い `FINAL` を取得。
2. **Plan フェーズ (`loop_mode: "plan"`)**:
   - Design の成果物ダイジェストをピン留めし、タスク DAG（JSON）を生成して `FINAL` を取得。
3. **Implement フェーズ (`loop_mode: "implement"`)**:
   - Plan の成果物ダイジェストをピン留めし、`version.js`, `main.js`, `helper.js`, テスト群を実装し、全テスト通過とサーバー `FINAL` を取得。

発見された注意点:
- MCP ツールの追加（例: `version` ツール）はツール数制約（7ツール固定）を破壊するため除外。
- CLI `--version` は stdio サーバー起動前にトラップする必要がある。

---

## 16. 却下された代替案 (rejected_alternatives)

| 代替案 | 却下理由 |
|---|---|
| 実行時に毎回 `package.json` を動的 `readFileSync` してパースする | パッケージ化やバンドル環境、パス解決の失敗時に `ENOENT` となるリスクがあり、外部依存ゼロ・自己完結の原則に反するため却下。 |
| MCP ツールとして `version` または `server_version` を新設する | strict-goal のツール一覧は 7 ツールに厳密に固定されており、ツール数を増やすと既存テスト（AT-11）および仕様互換性を損なうため却下。 |
| CLI `--version` の出力を JSON 形式（`{"version":"1.0.0"}`）のみにする | シェルスクリプトや一般的な CLI コマンドの標準作法（プレーンテキスト出力）から乖離し、直感的な確認が困難になるため却下。 |

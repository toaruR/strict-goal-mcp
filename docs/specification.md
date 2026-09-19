<!-- spec-doc:last-reviewed-commit=cdfc14a5b42d3ace6b92718ea3bc97a923b1c8b6 (strict-goal-mcp) reviewed-at=2026-09-07 -->

# 仕様書

## 1. 概要・システムアーキテクチャ

`strict-goal` は、LLM（AIコーディングエージェント）の自己評価バイアス、スコアインフレ、評価基準の忘却、および早期完了宣言（サボり）を構造的に排除し、客観的なルーブリック検証を満たすまでゴール完遂を強制する Model Context Protocol (MCP) サーバーおよびハーネスシステムである。

- **仕様準拠**:
  - Model Context Protocol (MCP) 2026-07-28（ステートレス改訂）および 2025-11-25
  - Agent Plugins 1.0.0 仕様（可搬プラグインマニフェスト `plugin.json`、ツールプロバイダー `mcp.json` / `mcp.http.json`）
- **通信モード**:
  - `stdio`（標準入出力 JSON-RPC 2.0、クライアント統合用）
  - `streamable-http`（HTTP デーモンモード、`http://127.0.0.1:<port>/mcp`）
- **ランタイム要件**:
  - Node.js >= 20.0.0（CI自動検証: Node.js 24.x）
  - 外部依存ゼロ（`node:fs`, `node:crypto`, `node:http` 等の標準組込モジュールのみで稼働）

---

## 2. パイプラインとセッション連鎖 (Chained Loop Modes)

ソフトウェア開発の各工程に対応する3つのセッションモード（`loop_mode`）を提供し、上流の確定成果物ダイジェスト（SHA-256）を暗号学的に固定（ピン留め）して連鎖する。

```
[ 要求・課題 ]
      │
      ▼
┌───────────┐     成果物ダイジェストピン留め (sha256)
│  design   │ ─────────────────────────────────┐
└───────────┘                                  │
  設計書・仕様書 (Markdown)                     ▼
                                        ┌───────────┐     成果物ダイジェストピン留め (sha256)
                                        │   plan    │ ─────────────────────────────────┐
                                        └───────────┘                                  │
                                          タスク依存DAG・計画 (JSON)                   ▼
                                                                                ┌───────────┐
                                                                                │ implement │
                                                                                └───────────┘
                                                                                  複数コード/テスト (fileset)
                                                                                  テストインベントリ・ミューテーション
```

| モード (`loop_mode`) | 成果物種別 (`artifact_kind`) | 成果物形式と制約 | 上流要件 |
|---|---|---|---|
| `design` | `markdown` | アーキテクチャ・仕様書本文（Markdown 文字列） | 不要（最上流） |
| `plan` | `plan` (JSON) | タスクDAG、`summary` (>=40文字)、`tasks[]`、`design_refs` を含む厳格な JSON | `FINAL` 確定した `design` セッションの `upstream_digest` |
| `implement` | `fileset` (multi-file) | 各ファイルパスと sha256 からなるマニフェスト、`test_inventory` (テスト実行結果・カウント) | `FINAL` 確定した `plan` セッションの `upstream_digest` |

### 2.1 上流連鎖保護 (Lineage Protection) とチェーン予算管理
1. **失効 (`SUPERSEDED`)**:
   - 上流セッションの確定成果物が変更（改変）された場合、下流セッションは直ちに `SUPERSEDED` 状態へ遷移し、追加のコミットや採点は拒絶（`E_SUPERSEDED`）される。
2. **リベース (`rebase`)**:
   - `escalate(action: "rebase")` により、改定された上流との差分を自動検査し、影響を受けた評価基準のみを特定して再採点対象とし、状態を `DRAFTING` へ復帰させる。
3. **差し戻し (`kickback`)**:
   - 実装中に上流仕様の欠陥を発見した場合、`escalate(action: "kickback")` を提起する。下流セッションは `FROZEN` 状態（`E_FROZEN`）で凍結され、上流セッションの再改定と人間の承認トークンを要求する。
4. **チェーンラウンド予算管理 (`chain round budget`)**:
   - チェーン全体の累積ラウンド数（`computeChainRounds`）を `score_submit` 時に自動検査。
   - 予算超過時:
     - 採点合格（`verdict === "FINAL"` / `"FINAL_WITH_RELAXATION"`）の場合: `FINAL` を維持し、`warnings: ["chain_budget_exceeded"]` を付与。
     - 採点不合格（`verdict !== "FINAL"`）の場合: `verdict: "REVISE"`, `state: "ESCALATED"` へ自動遷移し、エスカレーション情報（`detail: { reason: "chain_budget_exhausted", ... }`）と人間介入用トークンを発行。
     - 追加ラウンド消費後も超過が継続した場合は `E_CHAIN_BUDGET_EXHAUSTED` エラーを返出。
   - `escalate(action: "resolve", resolution: "continue")` により、セッションおよびチェーン全体に追加ラウンド枠（既定 +6周）が付与（`grantExtraRounds`）され、状態が `DRAFTING` へ復帰。

### 2.2 fileset の証跡照合仕様
- **マニフェスト照合**: サーバはワークスペースの実ファイルを直接走査しない（設計原則 A3: クライアント完全隔離）ため、`readArtifactContent` が返す成果物本文はマニフェスト JSON テキスト（`sha256-<digest>.manifest.json`）となる。
- **locator 根拠の制約**: `locator` 根拠の `excerpt` は個別ファイル本文ではなく、マニフェスト JSON テキスト内の実在文字列（`"path": "..."` 等）と照合される。
- **実行・テスト根拠**: 個別ファイルのコード実装やテスト結果の正当性は、`kind: "command"` 根拠（終了コード 0、標準出力ハッシュ、`target_digest`）によって証明する。

---

## 3. FSM (有限状態機械) とガードレール

セッションは厳格な状態遷移を持ち、モデルが勝手に完了を宣言することはできない。判定（verdict）を発行する権威はサーバー側のみに存在する。

### 3.1 状態一覧
- `INIT`: セッション開設直後（`loop_open` 実行完了時）。
- `DRAFTING` / `ARTIFACT_PENDING`: 成果物の執筆・改訂待ち。
- `SCORING`: 成果物コミット完了後、全基準に対する自己採点の提出待ち。
- `EVALUATED`: サーバー判定完了後、次周（`ITERATING`）への移行、または合格（`FINAL`）。
- `FINAL` / `FINAL_WITH_RELAXATION`: 合格基準（加重平均 >= 9.0、全基準最低点 >= 9）を満たし完了確定。
- `STALLED`: 連続停滞（スコア改善なしが規定周回継続）または `max_rounds` 到達による打ち切り。
- `ESCALATED`: 人間への支援要請、緩和承認待ち、チェーン予算枯渇（`chain_budget_exhausted`）、上流リベース、キックバック待ち。
- `SUPERSEDED` / `FROZEN`: 上流の成果物不整合による無効化・凍結。

### 3.2 アンチゲーミング・ガードレール仕様
1. **スコアインフレ検知 (`E_SCORE_INFLATION`)**:
   - 成果物の本文・マニフェストが前回と不変（`artifact_unchanged`）であるにもかかわらず、スコアを上げた提出を拒否。
2. **根拠の使い回し検知 (`E_EVIDENCE_STALE`)**:
   - 前周と完全に同一の根拠（`evidence_digest`）のままスコアを引き上げる提出を拒否。
3. **スコア急上昇検知 (`E_SCORE_JUMP`)**:
   - 1周で設定値（既定: 3点）を超える大幅な加点を行う場合、終了コード 0 の `command` 根拠が2件以上添付されていない限り拒否。
4. **理由・弱点申告の義務付け**:
   - 全基準について 40 文字以上の論理的理由（`rationale`）と弱点（`weakness`）を要求。満点（10点）以外での `'none'` 申告は `E_WEAKNESS_REQUIRED` で拒絶。
5. **停滞検知 (Stall Detection)**:
   - スコア改善幅が閾値（0.25）未満の周回が連続規定回数（`design`: 3回、`plan`: 2回）に達した、あるいは `max_rounds` に到達した場合、自動的に `STALLED` へ落とし進行を阻止。
6. **テスト後退検知 (`E_TEST_REGRESSION`, `E_TEST_NOT_GREEN`)**:
   - 前周に存在したテスト名の理由なき削除、テスト skip 数の増加を検知して拒否。テストが失敗（赤）している状態での合格点申告を拒絶。

---

## 4. 提供ツール仕様 (7 Orthogonal MCP Tools)

| ツール名 | 機能・役割 | 主な入力引数 (`inputSchema`) | 主な出力 |
|---|---|---|---|
| `loop_open` | セッションの新規開設（`mode: "create"`）または既存セッションの再開（`mode: "resume"`） | `mode`, `loop_mode`, `task`, `rubric_preset`, `upstream`, `label`, `allow_ephemeral` | `session_id`, `state`, `round`, `next_action`, `rubric` |
| `loop_state` | 現在の状態、周回番号、アクティブな基準、履歴の取得 | `session_id`, `include` (`["rubric", "history", "upstream"]`) | `state`, `round`, `next_action`, `last_evaluation`, `rubric` |
| `artifact_commit` | 成果物（Markdown文字列またはfilesetマニフェスト）のコミット | `session_id`, `expected_round`, `change_note`, `content` または `files`, `addresses`, `test_inventory` | `state`, `artifact_digest`, `diff`, `next_action: "score_submit"` |
| `score_submit` | ルーブリック全基準に対する採点・理由・弱点・エビデンスの提出 | `session_id`, `scores` (`[{ criterion_id, score, rationale, weakness, evidence }]`) | `verdict` (`ITERATING` / `FINAL` / `REVISE`), `weighted_mean`, `min_score`, `must_fix`, `next_action`, `escalation`, `warnings` |
| `rubric_amend` | 基準や閾値の変更（40文字以上の理由と緩和ログ記録） | `session_id`, `reason`, `amendments` (`add`, `modify`, `remove`) | `state`, `rubric_version`, `rubric_diff`, `is_final_reachable` |
| `escalate` | 人間への支援要請、上流リベース、キックバック、セッション再開 | `session_id`, `action` (`request_human` / `rebase` / `kickback` / `resolve` / `abort`), `human_token` | `state`, `escalation_id`, `resolution`, `chain` |
| `audit_export` | 改ざん検知可能な監査 JSON（セッション単位またはチェーン全体）の出力 | `session_id`, `scope` (`session` / `chain`), `include_artifacts`, `include_rejected`, `include_diffs` | `export` (`path`, `sha256`, `schema`) |

- **監査スキーマ識別子 (URN)**:
  - 単体セッション監査: `urn:strict-goal:schema:audit:v1`
  - 連鎖監査: `urn:strict-goal:schema:audit-chain:v1`
  - 同梱の `strict-goal/server/verify_audit.js` により、オフラインで監査ログの完全性・再計算検証が可能。

### 4.1 静的 HTML ダッシュボード自動生成 (`persistSession`)
セッション状態を変更する全7操作（`loop_open_create`, `artifact_commit`, `score_submit`, `rubric_amend`, `escalate`, `kickback`, `supersede`）の実行時、`src/store/persist.js` 経由でダッシュボードが自動再生成される。
- `<data_dir>/dashboard/<session_id>.html`: セッション詳細ダッシュボード（状態、周回、ルーブリック採点状況、must_fix、評価推移）。
- `<data_dir>/dashboard/index.html`: 全セッション一覧ダッシュボード（チェーンID、モード、最終判定、タイムスタンプ）。
- 各ダッシュボード HTML には `<meta http-equiv="refresh" content="5">` が付与され、外部ブラウザでのリアルタイム（5秒周期）自動更新に対応。

---

## 5. 人間向けインターフェース・スキル・補助CLI

AIエージェントおよび人間の開発者が自律的かつ自然言語で開発ループを円滑に回し、客観的検証と周回管理を遂行するためのインターフェース層と補助ツール群を提供する。

### 5.1 コマンド・人語連携スキル
- **スラッシュコマンド・フェーズショートカット**:
  - `/strict-goal <指示>`: 厳格モードで指定ゴールを実行（`design` → `plan` → `implement` の連鎖パイプラインを起動）。
  - `strict-goal <指示>`: CLI プレフィックスによる連鎖パイプライン起動。
  - `strict-goal [design|plan|implement] <target>`: フェーズを明示指定した直接起動。
- **自然言語トリガー**:
  - 「`strict-goalで` 〇〇を実装して」「`厳格モードで` 〇〇して」「`サボらずに` 〇〇して」などの人語指示を検知し自動起動。
- **実装前 `loop_open` 必須原則**:
  - `implement` フェーズでは、コード変更に着手する前に必ず `loop_open`（DRAFTING）を実行し、ダッシュボードへのセッション可視化と状態管理を先行させる。上流 plan の `session_id` は `.strict-goal/index.json` の直近 FINAL セッションから自動解決する。
- **階層型サブエージェント委譲 (Hierarchical Task Delegation Protocol)**:
  - 親エージェントのコンテキスト肥大化とテスト実行ノイズを防ぐため、3層構造の自律委譲プロトコルを標準化。
  - **親（メインエージェント）**: `design` → `plan` の策定・採点完遂、全体統括。
  - **子 (`sg-implementer`)**: 実装監督エージェント（`enable_subagent_tools: true`）。実装着手前に `loop_open` を呼び出し、上流 `plan` の `tasks[]` を解析して孫へ順次委譲。テスト検証・マニフェスト fileset 生成・周回提出を統括。
  - **孫 (`sg-worker`)**: 単一タスク（または `must_fix` 1件）の実装と単体テスト通過のみを担当する極小コンテキスト作業エージェント。ハーネス操作や git コミットは行わず、完了報告後に破棄。
  - **単体自律実装 (`sg-coder`)**: 階層化せず単一サブエージェントで直接 `strict-goal implement` を自律周回する実装エージェント。
  - **エージェント定義**: `.agents/agents/` および `.claude/agents/` 配下の `sg-implementer.md`, `sg-worker.md`, `sg-coder.md`

### 5.2 補助CLIツール (`strict-goal/server/helper.js`)
- `node strict-goal/server/helper.js version`:
  - strict-goal のバージョン文字列（`strict-goal 1.0.0`）を標準出力に表示（`--version`, `-v` も可）。
- `node strict-goal/server/helper.js fileset <path...>`:
  - 指定ファイル群の SHA-256 およびマニフェストダイジェストを JSON 出力（`artifact_commit` 用）。
- `node strict-goal/server/helper.js test-run "<command>"`:
  - テストコマンドを実行し、終了コード、出力ダイジェスト、テスト件数（pass/fail/skip/total）を抽出し `test_inventory` 形式の JSON として出力（`score_submit` 用）。
- `node strict-goal/server/helper.js verify-doc <docPath>`:
  - Markdown 仕様書・設計書を静的解析し、見出し構造（H1〜H6）、各セクションの文字数・内容充実度を検証。検出された弱点リスト（weaknesses）および推奨スコアを JSON で出力（`design` モードの客観的検証用）。

### 5.3 Round 1 即時終了防止・反復推敲強制メカニズム (Anti-Round-1 Finalization)
エージェントの自己評価バイアスによる初回（Round 1）での安易な合格判定と即時終了を防止するため、サーバーサイドで以下の強制規則を適用する。

1. **反復保証ポリシー (`policy.min_rounds`)**:
   - `min_rounds` (デフォルト: 2): セッション完了（`FINAL` 判定）に必要な最低周回数。Round 1 で全基準が合格スコア（例: 9点）に達していても、サーバーは判定 `ITERATING`、判定理由 `min_rounds_not_reached`、フラグ `enforced_iteration: true` を返し、強制的に次周での改善推敲を要求する。
2. **初回スコア上限と粗探し強制 (`policy.first_round_ceiling`, `policy.min_first_round_must_fix`)**:
   - `first_round_ceiling` (デフォルト: 8): 初回周回での各基準スコアの上限値。
   - `min_first_round_must_fix` (デフォルト: 1): Round 1 で提出を義務付ける `pass_score` 未満の課題数。満たさない場合、`E_FIRST_ROUND_UNCRITICAL` エラーにより提出が拒絶される。
3. **逃避的 Weakness ブラックリスト (`E_WEAKNESS_EVASIVE`)**:
   - 課題・弱点（`weakness`）に自己満足的または逃避的な表現（`問題なし`、`特になし`、`満たしている`、`完璧である`、`十分である` 等）が含まれる場合、`E_WEAKNESS_EVASIVE` により採点提出を即時拒絶し、具体的・建設的な指摘を強制する。

### 5.4 バージョン管理と確認方法
- **単一情報源 (Single Source of Truth)**:
  - `strict-goal/server/src/version.js` (`VERSION = '1.0.0'`, `NAME = 'strict-goal'`)
- **CLI からの確認**:
  - `node strict-goal/server/main.js --version` (または `-v`): `strict-goal 1.0.0` を出力し終了コード 0。
  - `node strict-goal/server/helper.js version` (または `--version`, `-v`): `strict-goal 1.0.0` を出力し終了コード 0。
- **MCP プロトコルからの確認**:
  - `initialize` ハンドラ: `serverInfo.name: "strict-goal"`, `serverInfo.version: "1.0.0"`
  - `server/discover` ハンドラ: `serverInfo.name: "strict-goal"`, `serverInfo.version: "1.0.0"`
- **セッション永続化メタデータ**:
  - `loop_open` で生成される `session.json` の `server.version` に実行時バージョンが記録される。

---

## 6. ライセンスと配布

- **ライセンス**: MIT License (`LICENSE`)
- **メタデータ**: `strict-goal/plugin.json` (Agent Plugins 1.0.0 準拠)
- **環境変数フォールバック**:
  - データディレクトリ: `STRICT_GOAL_DATA` || `RUBRIC_LOOP_DATA` || `PLUGIN_DATA` || XDG
  - プラグインルート: `STRICT_GOAL_ROOT` || `RUBRIC_LOOP_ROOT` || `PLUGIN_ROOT`


# Strict Goal MCP (`strict-goal`)

> **サボらせない・妥協を許さないゴール完遂ハーネス**  
> **ルーブリック（評価基準）に基づくAIコーディングエージェントの反復改善ループを、サーバー側の状態と閾値判定によって強制する Agent Plugins 1.0.0 & MCP サーバー**

[English README (README.md)](./README.md)

---

## 概要

LLMエージェントがプロンプト内の自己反省（「段階的に考えよ」「自己採点して改善せよ」）のみで改善ループを回そうとすると、以下のような失敗モード（ごまかし・サボり・破綻）が頻発します:
- **自己採点の甘え・スコアインフレ**: 成果物を実質的に直していないのに周回ごとに点数だけを高く申告する。
- **評価基準の忘却**: 長い会話やコンテキスト圧縮・切り詰めによって基準や以前のスコアが消失する。
- **早期完了宣言（サボり）**: 実際には合格基準を満たしていないにもかかわらず、エージェントが勝手に「完了（FINAL）」と判断して作業を打ち切る。
- **基準の勝手な緩和**: 達成が難しい基準をエージェント自身がプロンプト内で勝手に緩めて合格扱いにする。

**`Strict Goal MCP` (`strict-goal`)** は、状態追跡・FSM（状態機械）遷移・合否判定を **LLMの自制心やコンテキストから切り離し、決定論的なMCPサーバー側に外部化** することでこの問題を根本から解決します。エージェントは成果物をコミットし、各基準に行・コマンドレベルの根拠と弱点を添えて自己採点を送信します。サーバー側が客観的に閾値ロジック、停滞検知、アンチゲーミング（不正採点検出）を評価し、`ITERATING`（次周継続）か `FINAL`（合格確定）かを厳格に判定します。

---

## 主要コンセプト

### 1. 3つの連鎖モード (Loop Modes)

ソフトウェア開発のライフサイクルに対応する3つのセッションモードを提供し、それぞれ上流から暗号学的に連鎖します:

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

| モード | 成果物種別 | 目的 | 上流要件 |
|---|---|---|---|
| `design` | `markdown` | 要求からアーキテクチャ・技術仕様書を策定 | 不要 |
| `plan` | `plan` (JSON) | 仕様書をタスクDAG・明示的依存関係に分解 | `FINAL` 確定した `design` セッションのダイジェスト |
| `implement` | `fileset` (複数ファイル) | 計画に合致するコードとテストを実装 | `FINAL` 確定した `plan` セッションのダイジェスト |

### 2. 上流連鎖と系統保護 (Lineage Protection)

- **ダイジェストのピン留め**: 下流セッションは開始時に上流セッションIDとその成果物ダイジェストを記録します。
- **リベース (Rebase)**: 上流成果物が改訂された場合、下流セッションは自動的に `SUPERSEDED`（無効化）となります。`escalate(action: "rebase")` を実行すると、差分から影響を受けた基準のみを特定して再採点対象とします（最初からやり直す必要はありません）。
- **キックバック (Kickback)**: 実装中に上流仕様の重大な欠陥を発見した場合、下流で辻褄を合わせず `escalate(action: "kickback")` を提起します。セッションは凍結され、人間の承認トークンと上流の修正を要求します。

### 3. サーバー側アンチゲーミングとガードレール

エージェントによる近道やごまかしを構造的に遮断します:
- **厳密なFSM状態機械**: 許可されていない状態遷移を構造的に排除（`INIT` → `ARTIFACT_PENDING` → `SCORING` → `EVALUATED` → `FINAL` / `ITERATING` / `ESCALATED`）。
- **スコアインフレ防止**: 成果物が前回と同一（`artifact_unchanged`）である場合や、客観的根拠の裏付けがないスコア上昇を `E_SCORE_INFLATION` で拒否。
- **理由・弱点記述の義務化**: 全ての基準について、40文字以上の論理的理由と弱点（weakness）の提出を要求。満点（10点）以外での `'none'`（弱点なし）申告を禁止。
- **停滞検知 (Stall Detection)**: $N$ 周（既定: 3周）連続でスコア改善が見られない場合、ループを自動的に中断し `ESCALATED` 状態へ移行。
- **検証可能エビデンス**: 成果物内の行範囲引用や、テストコマンドの実行結果ダイジェストの添付を必須化。

### 4. 完全な監査性と検証可能JSON

全周回の成果物スナップショット・差分・自己採点・理由・エビデンス・サーバー判定が永続化されます。`audit_export` を呼ぶことで改ざん検知可能な監査JSON（セッション v1 / チェーン v2 スキーマ）を出力でき、同梱の `verify_audit.js` により第三者がオフラインで完全性を再検証可能です。

---

## 提供ツール (7 MCP Tools)

直交性に配慮した最小限の7つのツールを提供します:

| ツール名 | 役割・機能 | 主な入力引数 |
|---|---|---|
| `loop_open` | 新規ループセッションの開始、または既存セッションの再開 | `mode` (`create` / `resume`), `loop_mode`, `task`, `rubric_preset`, `upstream` |
| `loop_state` | 現在のFSM状態・周回番号・アクティブな基準・履歴の取得 | `session_id`, `include` (`["rubric", "history", "upstream"]`) |
| `artifact_commit` | 周回の成果物全文（Markdown等）または fileset のコミット | `session_id`, `expected_round`, `change_note`, `content` または `files`, `addresses` |
| `score_submit` | ルーブリック全基準に対する自己評価・理由・弱点・根拠の提出 | `session_id`, `scores` (`[{ criterion_id, score, rationale, weakness, evidence }]`) |
| `rubric_amend` | 厳格なポリシーと40文字以上の理由ログを伴う基準・閾値の変更 | `session_id`, `reason` (40文字以上), `amendments` |
| `escalate` | 人間への支援要請、上流リベース、上流への差し戻し（キックバック） | `session_id`, `action` (`request_human` / `rebase` / `kickback`), `human_token` |
| `audit_export` | 検証用監査JSON（セッション単位またはチェーン全体）の出力 | `session_id`, `scope` (`session` / `chain`), `include_artifacts` |

---

## Agent Plugins 1.0.0 準拠

本プロジェクトは [Agent Plugins 1.0.0 仕様](https://agent-plugins.org/specification) に完全準拠しています:

- **パッケージ構成**:
  - `plugin.json`: プラグインメタデータとスキーマバージョン定義。
  - `mcp.json`: MCPツールプロバイダー定義。
  - `skills/`: `skills/strict-goal/SKILL.md` によるエージェント向け実行規範。
- **可搬ホスト変数**: `${PLUGIN_ROOT}` と `${PLUGIN_DATA}` の標準解決（`${CLAUDE_PLUGIN_ROOT}` などのベンダー環境変数や標準XDGデータパスへの自動フォールバックに対応）。
- **ゼロ外部ランタイム依存**: Node.js 標準モジュール（`node:fs`, `node:crypto`, `node:http` 等）のみで実装され、`npm install` なしで起動可能。

---

## クイックスタート

### 動作要件

- Node.js >= 20.0.0
- MCP 対応クライアント（Claude Code, Antigravity, Cursor, VS Code, Codex CLI 等）

### 1. クライアント設定

#### Stdio モード（標準）

使用するクライアントの MCP 設定ファイル（`.mcp.json` や設定画面）に追記します:

```json
{
  "mcpServers": {
    "strict-goal": {
      "command": "node",
      "args": [
        "/path/to/strict-goal/server/main.js",
        "--data-dir",
        "/path/to/persistence/data"
      ],
      "env": {
        "STRICT_GOAL_LOG": "info"
      }
    }
  }
}
```

#### Streamable HTTP モード

サーバーを HTTP デーモンとして起動します:

```bash
node strict-goal/server/main.js --http --port 8971 --data-dir /path/to/data
```

クライアントから `http://127.0.0.1:8971/mcp` を参照するように設定します。

---

## 人間フレンドリーな指示インターフェース (`/goal` / 人語指示)

`strict-goal` は低レベルな MCP ツール群だけでなく、エージェントが自律的にループを回せるスキル・コマンド連携を備えています。

### 1. スラッシュコマンドによる指示
Claude Code、Antigravity、Codex CLI 等で以下のコマンドを実行すると、`strict-goal` ハーネスが自動起動し、`design` → `plan` → `implement` の連鎖ループが始まります。

```bash
/goal ユーザー認証APIにレートリミット機能を追加し、単体テストを完備する
```
または
```bash
/strict-goal ユーザー認証APIにレートリミット機能を追加し、単体テストを完備する
```

### 2. 自然言語（人語）による指示
通常チャットでも以下のようなキーワードを含めると、スキルがトリガーされてサーバー主導の厳格ループが開始されます:
- 「**strict-goalで** 〇〇を実装して」
- 「**厳格モードで** 〇〇のバグを修正して」
- 「**サボらずに** 〇〇のリファクタリングを完遂して」

### 3. 進捗レポートの自動出力
エージェントは各周回の評価完了後、ユーザーに対して自動的に進捗サマリーを報告します:
```markdown
🔄 [design] 第 1 周 評価結果:
- 判定: ITERATING (要改善)
- 主な要修正項目:
  - error_handling: 異常系のエラーコード定義が不足
- アクション: 設計書にエラーハンドリング節を追加して再コミットします...
```

### 4. HTMLダッシュボード
ブラウザで `<data_dir>/dashboard/index.html` を開くだけで確認できます。
`session_id` を覚えている必要も、専用ツールを呼ぶ必要もありません。状態変更を伴うツール
（`loop_open` / `artifact_commit` / `score_submit` / `escalate` / `rubric_amend`）が呼ばれるたびに、
`<data_dir>/dashboard/` 以下の静的HTMLが自動的に最新化されます:

- `index.html` — 既知の全セッションをチェーンごとにまとめた一覧（loop_mode/state/round/taskが一目でわかる）
- `<session_id>.html` — 個別セッションの詳細（周回・状態・判定・基準ごとのスコアと弱点・`must_fix`・次に呼ぶべきツール）


---

## 補助CLIツール (`strict-goal/server/helper.js`)

`implement` モードにおける `artifact_commit`（fileset の sha256 算出）や `score_submit`（テスト実行結果・カウント収集）を自動化するゼロ依存 Node.js ヘルパーを提供しています。

```bash
# 指定ファイル群の sha256 と manifest digest を JSON 出力
node strict-goal/server/helper.js fileset <path1> <path2> ...

# テストコマンドを実行し、終了コード・出力ダイジェスト・テスト件数を test_inventory 形式で出力
node strict-goal/server/helper.js test-run "<command>"
```

---

## 実行フローの例

1. **セッション開始**:
   エージェントが `loop_open(mode: "create", loop_mode: "design", rubric_preset: "design", task: "認証モジュール設計")` を呼ぶ。
   サーバーは `session_id` と `next_action: "artifact_commit"` を返す。

2. **成果物のコミット**:
   エージェントが設計書の全文を作成し、`artifact_commit(session_id, expected_round: 1, content: "...", change_note: "初回ドラフト作成")` を呼ぶ。
   サーバーの状態機械が `SCORING` に遷移する。

3. **自己評価の提出**:
   エージェントが全基準に対して採点・理由・弱点・エビデンスを揃えて `score_submit(...)` を呼ぶ。

4. **サーバー判定**:
   - 加重平均または最低点基準が閾値未満の場合: サーバーが `verdict: "ITERATING"` を返し、周回番号を進め、優先修正項目 `must_fix` を指定。エージェントは手順2に戻り成果物を改訂。
   - 全基準が閾値を満たした場合: サーバーが `verdict: "FINAL"` を出力し、完了が確定。

5. **監査エクスポート**:
   `audit_export(session_id, scope: "session")` を呼び出し、一連の改善ログを JSON として出力・保存。

---

## テストとオフライン検証

### 自動テストの実行

状態機械、アンチゲーミング、原子的I/O、チェーン予算などを含む120以上の包括的テストスイートを実行します:

```bash
cd strict-goal/server
npm test
```

### 監査JSONの整合性検証

エクスポートされた監査JSONが改ざんされていないかオフラインで検証します:

```bash
node strict-goal/server/verify_audit.js ./path/to/audit.json
```

---

## ディレクトリ構成

```
strict-goal-mcp/
├── strict-goal/              # コア Agent Plugin パッケージ
│   ├── plugin.json           # Agent Plugins 1.0.0 マニフェスト
│   ├── mcp.json              # stdio MCP 設定
│   ├── mcp.http.json         # streamable-http MCP 設定
│   ├── presets/              # デフォルト評価基準プリセット (design, plan, implement)
│   ├── skills/               # エージェント用スキル定義 (skills/strict-goal/SKILL.md)
│   └── server/               # Node.js MCP サーバー実装
│       ├── main.js           # サーバー起動エントリポイント
│       ├── schemas/          # ツール・plan・fileset 用 JSON Schema
│       ├── src/              # コア実装 (FSM・判定・永続層・各ツール・チェーン等)
│       ├── test/             # 単体・結合テストスイート
│       └── verify_audit.js   # 監査ログ検証スクリプト
├── docs/                     # アーキテクチャ設計書・仕様書・分割実行計画書
│   ├── design-rubric-loop-mcp.md
│   └── plans/
├── LICENSE                   # MIT ライセンス
├── README.md                 # 英語版ドキュメント
└── README.ja.md              # 日本語版ドキュメント（本ファイル）
```

---

## ライセンス

[MIT License](./LICENSE)。詳細は [LICENSE](./LICENSE) または `plugin.json` を参照してください。

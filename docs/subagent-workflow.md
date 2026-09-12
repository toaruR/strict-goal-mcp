# 設計から実装までのサブエージェント呼び出しフロー (strict-goal-agy)

本ドキュメントは、`strict-goal-agy`（SKILL.state ステートレス実行基盤対応版 strict-goal）において、要件定義・設計（design）から計画（plan）、実装（implement）に至る全ライフサイクルで**サブエージェントがどのように階層的に呼び出され、責務分担されるか**を図示・解説したものです。

---

## 1. 全体ライフサイクル概要 (End-to-End Pipeline)

strict-goal は、サーバー主導のルーブリック評価によって各フェーズの完了（`FINAL` 判定）を厳格に保証します。
親エージェント（Orchestrator）のコンテキスト枯渇・テストログ汚染を防ぐため、**設計・計画は親または特化型エージェント、実装フェーズは 3 層階層型サブエージェント（親 → 子監督 → 孫ワーカー）** に委譲します。

```mermaid
flowchart TD
    User(["👤 ユーザー指示<br>('/goal <目標>' または 'strict-goal <目標>')"])

    subgraph Phase1["Phase 1: 設計 (Design Phase)"]
        Main1["メインエージェント (Orchestrator)<br>or architect サブエージェント"]
        SG_Server1[("strict-goal MCP<br>(loop_mode: design)")]
        DocDesign["成果物: 仕様書 Markdown<br>+ ダイジェスト D_design"]
        Main1 -->|"loop_open / artifact_commit / score_submit"| SG_Server1
        SG_Server1 -->|"ルーブリック合否判定 (FINAL)"| DocDesign
    end

    subgraph Phase2["Phase 2: 計画 (Plan Phase)"]
        Main2["メインエージェント (Orchestrator)<br>or architect サブエージェント"]
        SG_Server2[("strict-goal MCP<br>(loop_mode: plan)<br>upstream: D_design")]
        DocPlan["成果物: 計画 JSON (Task DAG)<br>+ ダイジェスト D_plan"]
        DocDesign -.->|"上流拘束"| Main2
        Main2 -->|"loop_open / artifact_commit / score_submit"| SG_Server2
        SG_Server2 -->|"ルーブリック合否判定 (FINAL)"| DocPlan
    end

    subgraph Phase3["Phase 3: 実装 (Implement Phase) 【3層階層委譲】"]
        Parent["親: メインエージェント (Orchestrator)"]
        Child["子: sg-implementer (実装監督)<br>※ Antigravity: invoke_subagent(self)"]
        Grandchildren["孫: 使い捨てワーカー群 (Ephemeral Workers)<br>・sg-scout (コード調査)<br>・sg-worker (タスク実装/単体テスト)<br>・sg-verifier (テスト検証/採点提出)"]
        SG_Server3[("strict-goal MCP<br>(loop_mode: implement)<br>upstream: D_plan")]

        DocPlan -.->|"上流拘束"| Parent
        Parent ==>|"invoke_subagent<br>(Role: Implementation Supervisor)"| Child
        Child <-->|"順次タスク委譲 & 報告"| Grandchildren
        Child <-->|"fileset commit / score_submit / skill_state 取得"| SG_Server3
        SG_Server3 -->|"FINAL 判定"| Child
        Child ==>|"最終確定ダイジェスト D_implement & 完了報告"| Parent
    end

    User ==> Phase1
    Phase1 ==> Phase2
    Phase2 ==> Phase3
    Phase3 ==> Done(["🏁 全工程完了 (完全検証済み)"])
```

---

## 2. 実装フェーズ（Phase 3）の詳細シーケンス図

実装フェーズでは、コード編集や大量のテストログで親のコンテキストが圧迫されるのを防ぐため、**「子監督（`sg-implementer`）」がループ進行と FSM セッションを統括**し、**個別の作業トランザクションを「孫（使い捨てワーカー）」に委譲**します。

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 ユーザー
    participant Parent as 🧠 親: メインエージェント
    participant Child as 👔 子: sg-implementer (監督)
    participant Scout as 🔍 孫: sg-scout (調査)
    participant Worker as 🔨 孫: sg-worker (実装)
    participant Verifier as 🧪 孫: sg-verifier (検証/提出)
    participant MCP as 🛡️ strict-goal MCP サーバー

    User->>Parent: "strict-goal implement <plan_path>"
    
    Note over Parent,Child: 1. 実装監督サブエージェントの起動 (コンテキスト完全隔離)
    Parent->>Child: invoke_subagent("Execute strict-goal implement...")
    
    Note over Child,MCP: 2. 実装前セッション開設 (DRAFTING)
    Child->>MCP: loop_open(mode: "create", loop_mode: "implement", upstream: { session_id, D_plan })
    MCP-->>Child: session_id, state: DRAFTING, next_action: "artifact_commit"
    Child->>Child: 上流 plan の tasks[] を解析し実行順序決定

    rect rgb(240, 248, 255)
        Note over Child,Verifier: === タスク 1 の実行トランザクション ===
        
        opt 事前コード調査が必要な場合
            Child->>Scout: invoke_subagent("Investigate symbols for Task 1")
            Scout->>Scout: BM25/Grep/Read 調査 (生コードを親に見せない)
            Scout-->>Child: 調査結果サマリ ΔΣ (ファイルパス, 型定義, 制約のみ)
            Note over Scout: 調査完了後即時破棄
        end

        Child->>Worker: invoke_subagent("Implement Task 1 & pass unit tests")
        Worker->>Worker: 局所的なコード編集 + 単体テスト作成
        Worker->>Worker: テスト実行 (exit 0 を確認)
        Worker-->>Child: 完了報告 (変更ファイル一覧, テスト成功結果)
        Note over Worker: 実装完了後即時破棄
    end

    rect rgb(255, 245, 238)
        Note over Child,Verifier: === 総合テスト & ルーブリック採点周回 ===
        
        Child->>Verifier: invoke_subagent("Run integration tests, fileset & submit")
        Verifier->>Verifier: helper.js test-run (テスト実行・ログ要約)
        Verifier->>Verifier: helper.js fileset (マニフェスト計算)
        Verifier->>MCP: artifact_commit(files, manifest, test_inventory)
        MCP-->>Verifier: digest: D_round1, state: EVALUATING
        Verifier->>MCP: score_submit(scores, rationales, evidence)
        
        alt サーバー判定が ITERATING (must_fix あり) の場合
            MCP-->>Verifier: verdict: ITERATING, must_fix: ["test_coverage"]
            Verifier-->>Child: must_fix 報告
            Note over Verifier: 提出完了後即時破棄
            
            Child->>MCP: loop_state(projection: "skill_state")
            MCP-->>Child: 有界三つ組 (P, Σ_t, O_t) [4,000文字以内]
            
            Child->>Worker: invoke_subagent("Fix must_fix: test_coverage")
            Worker->>Worker: 不足テスト追加 & green 確認
            Worker-->>Child: 修正完了報告
            
            Note over Child,Verifier: 次ラウンドの commit & score_submit へ (ループ)
        else サーバー判定が FINAL (合格) の場合
            MCP-->>Verifier: verdict: FINAL, digest: D_implement
            Verifier-->>Child: FINAL 達成報告 (D_implement)
            Note over Verifier: 提出完了後即時破棄
        end
    end

    Child-->>Parent: 実装完了報告 (D_implement, 完了タスク, テスト全勝サマリ)
    Note over Child: 監督セッション終了
    Parent-->>User: 全工程完了報告 (成果物リンク & ダッシュボード)
```

---

## 3. エージェント階層と責務分担マトリクス

`strict-goal-agy` では、各エージェントのライフサイクルとツール権限を厳密に制限することで、**責任の局所化**と**コンテキストの最小化**を実現しています。

| 階層 | エージェント名 | ライフサイクル | ツール権限 | 主な責務・役割 |
|---|---|---|---|---|
| **第 1 層 (親)** | **Orchestrator**<br>(メインエージェント) | セッション全体常駐 | 全ツール (`Agent`, MCP, Bash, Read, Write 等) | ・ユーザー対話・ゴール受領<br>・`design` → `plan` の策定と採点完遂<br>・子エージェント (`sg-implementer`) の起動と最終受領 |
| **第 2 層 (子)** | **`sg-implementer`**<br>(実装監督) | 実装フェーズ常駐 | `invoke_subagent`, `Agent`, Bash, Read, Write, strict-goal MCP | ・`loop_open` による DRAFTING セッション開設<br>・上流 `plan` のタスク依存解析 (`tasks[]`)<br>・各タスクの孫ワーカーへの順次ディスパッチ<br>・サーバーの `must_fix` 解消管理と反復判定制御 |
| **第 3 層 (孫)** | **`sg-scout`**<br>(コード探索・調査) | **使い捨て (Ephemeral)**<br>(調査完了で即破棄) | BM25 `search`, Read, Grep, Glob, Bash | ・対象ファイルやシンボル、依存関係の特定<br>・数千行の生コードを読んでも親には **要約事実 ($\Delta \Sigma$) のみ** を返却 |
| **第 3 層 (孫)** | **`sg-worker`**<br>(単一タスク実装) | **使い捨て (Ephemeral)**<br>(タスク完了で即破棄) | Read, Write, Edit, Grep, Glob, Bash, BM25 `search`<br>*(strict-goal MCP 禁止)* | ・指示された 1 タスク / 1 `must_fix` の実装<br>・単体テスト作成とローカル pass (exit 0) の確認<br>・ハーネスや git commit の操作は行わない |
| **第 3 層 (孫)** | **`sg-verifier`**<br>(検証・採点提出) | **使い捨て (Ephemeral)**<br>(採点完了で即破棄) | Bash, Read, `artifact_commit`, `score_submit`, `loop_state`<br>*(コード編集禁止)* | ・`helper.js test-run` によるテスト実行とログサニタイズ<br>・`helper.js fileset` によるマニフェスト計算<br>・成果物提出・採点送信とサーバー合否判定の親への伝達 |

---

## 4. ホスト環境ごとのサブエージェント呼び出し差異の吸収

`strict-goal-agy` は、ホスト環境（Antigravity / Claude Code）のサブエージェント API 差異をスキル層 (`SKILL.md`) で吸収します。

```mermaid
graph TD
    subgraph HostAgents["ホスト環境別のディスパッチ方式"]
        AGY["Google Antigravity (AGY)"]
        CC["Claude Code"]
    end

    subgraph AGY_Dispatch["Antigravity での呼び出し"]
        AGY_Call["invoke_subagent(<br>  TypeName: 'self',<br>  Role: 'Implementation Supervisor',<br>  Workspace: 'inherit',<br>  Prompt: 'Execute strict-goal implement...'<br>)"]
    end

    subgraph CC_Dispatch["Claude Code での呼び出し"]
        CC_Call["Agent(<br>  subagent_type: 'sg-implementer',<br>  prompt: 'Execute strict-goal implement...'<br>)"]
        CC_Worker["Agent(<br>  subagent_type: 'sg-worker',<br>  prompt: 'Implement task 1...'<br>)"]
    end

    AGY --> AGY_Call
    CC --> CC_Call
    CC_Call --> CC_Worker
```

1. **Google Antigravity**:
   - `invoke_subagent` ツールを使用。
   - `TypeName: "self"` かつ `Role: "Implementation Supervisor"`, `Workspace: "inherit"` を指定して起動。
2. **Claude Code**:
   - `.agents/agents/` または `.claude/agents/` 配下のサブエージェント定義を参照。
   - `Agent(subagent_type="sg-implementer", prompt=...)` で子監督を起動し、監督内から `Agent(subagent_type="sg-worker", ...)` で孫ワーカーを順次起動。

---

## 5. SKILL.state によるステートレス復帰アーキテクチャ

サブエージェントが途中で異常終了した場合やコンテキストが溢れた場合でも、`strict-goal-agy` ではセッションを安全に再開できます。

```mermaid
flowchart LR
    subgraph SessionLost["コンテキスト消失・サブエージェント再起動"]
        FreshAgent["新規 / 再起動サブエージェント<br>(コンテキスト 0)"]
    end

    subgraph MCPProjection["strict-goal-agy MCP サーバー"]
        Store[("セッション・試行履歴<br>(ディスク永続化)")]
        Projector["SKILL.state Projector<br>(src/skill_state/projector.js)"]
        Store --> Projector
    end

    subgraph Triad["有界三つ組 (4,000文字以内)"]
        P["P (immutable_spec)<br>目標・ルーブリック基準要約"]
        Sigma["Σ_t (canonical_state)<br>現在round・状態・must_fix・試行履歴"]
        O["O_t (recent_observation)<br>直前ステップのサニタイズ観測結果"]
    end

    FreshAgent -->|"loop_state(session_id, projection: 'skill_state')"| Projector
    Projector -->|"プロジェクション生成"| Triad
    Triad -->|"0ターンで即座に作業復帰"| FreshAgent
```

- **有界射影 ($P, \Sigma_t, O_t$)**:
  - `loop_state` に `projection: "skill_state"` を指定することで、過去の巨大な対話履歴を読み込まずとも、4,000 文字以内の最小限の要約データだけで作業を再開可能。
- **生ログの外部永続化**:
  - 詳細なテスト出力やエラーログは `.strict-goal/sessions/<session_id>/logs/` に外部退避され、親・子エージェントには要約（`helper.js sanitize-test` 経由）のみが渡されます。

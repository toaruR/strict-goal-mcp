---
name: strict-goal
description: Enforces iterative rubric validation until the server itself returns a passing verdict, preventing compromises or shortcuts. Triggered by natural language requests or command syntax like "strict-goal [design|plan|implement|設計|計画|実装] <target/instruction>" or "/strict-goal <goal>".
---
<!-- knowledge-kit version=1.12.0 (自動調整済み: 移植先固有の書き換えあり) -->

## Principles

The server decides pass/fail, not you. Your job is to submit artifacts,
score them objectively with rigorous evidence, and resolve the must_fix items the server returns.
Never decide on your own that "this is good enough."
FINAL is a verdict only the server can issue; the model is forbidden from declaring FINAL itself.

- **Verifier Separation (評価の独立分離).** Never grade your own creation. Author models have inherent self-enhancement bias that causes single-round premature completion (especially in advanced models like Gemini). Always delegate evaluation, fault-finding (粗探し), and scoring to the adversarial subagent `sg-verifier`. The verifier operates under zero-trust, relentlessly searches for edge-case omissions, strictly penalizes deficiencies, and enforces iterative refinement loops.

## Command Syntax & Mode Selection (モードの選び方)

Users can invoke either the full chain or a single targeted phase using English or Japanese keywords:

| Command Syntax | Target Phase | Behavior |
|---|---|---|
| `strict-goal design <instruction>`<br>`strict-goal 設計 <指示>` | `design` only | Creates specification document. Runs rubric iteration loop until server returns FINAL, then stops (does not advance to plan/implement). |
| `strict-goal design --preset design.harness <instruction>`<br>`strict-goal 設計 --preset design.harness <指示>` | `design.harness` only | Creates specification document for harnesses/protocols. Runs rubric iteration loop until server returns FINAL, then stops. |
| `strict-goal plan <design_doc_path> [instruction]`<br>`strict-goal 計画 <設計書パス> [指示]` | `plan` only | Reads the given design document, generates task DAG & acceptance criteria (JSON), and iterates until server returns FINAL, then stops (does not advance to implement). If no upstream design session exists, immediately creates and finalizes a minimal design session referencing the document to satisfy server chain integrity. |
| `strict-goal implement <plan_doc_path> [instruction]`<br>`strict-goal 実装 <計画書パス> [指示]` | `implement` only | Reads the given plan. Before touching code, calls `loop_open` first (auto-resolving upstream plan from `.strict-goal/index.json`'s latest session where server returned FINAL) to enter DRAFTING, then implements code & tests, runs verification, and iterates until server returns FINAL. |
| `strict-goal <goal>`<br>`/strict-goal <goal>` | `design` → `plan` → `implement` | Default: Executes the entire sequential pipeline until the final implement phase's server returns FINAL. |

### LLM-Driven Rubric Scope Decision (LLMによる設計スコープの自律判定)

`strict-goal design` を実行する際、エージェントはキーワードの単純一致ではなく、**要求プロンプトの意味的責務境界（スコープ）を自律判定**して適切な `rubric_preset` を選択して `loop_open` を呼び出すこと：

- **サブセット（汎用 `design` / 8基準: scope_adherence, numeric_roundtrip, interface_completeness 等）**:
  - **適用対象**: 単一クラス、アルゴリズム、データ構造、APIエンドポイント、ユーティリティ、業務ロジック等の通常のソフトウェア設計。
  - **判定根拠**: 要求がインメモリや局所コンポーネントのロジック・仕様であり、「耐不正性（anti-gaming）」「自律実行ループ状態機械」「合否判定権の外部化」といったエージェント自律基盤のメタ要件を含まない場合。
  - **指定方法**: `loop_open` に `rubric_preset: "design"` を指定（汎用設計のデフォルト）。
- **フルセット（ハーネス用 `design.harness` / 18基準: packaging, self_hosting, anti_gaming, verdict_ownership, dependency_conformance 等）**:
  - **適用対象**: 自律エージェントループ、MCPサーバー、FSM状態機械、反復検証ハーネス、プロトコル基盤の設計。
  - **判定根拠**: エージェント基盤そのもののメタ要件（配布パッケージ仕様、第三者監査ログ、自己適用レビュー手順、モデル不正採点防止等）が必須となる場合。
  - **指定方法**: `loop_open` に `rubric_preset: "design.harness"` を指定。

### Pipeline Overview

| Task | loop_mode | Upstream | Output |
|---|---|---|---|
| Write a design document from requirements | design | none | Specification Markdown |
| Write an implementation plan from a finalized design | plan | design session handle & artifact digest | Task DAG (JSON) |
| Write code and tests from a finalized plan | implement | plan session handle & artifact digest | Fileset + Test Inventory |

If you don't know the upstream digest, call `loop_state` on the upstream session to get it.
For `implement`, if upstream session ID is omitted, auto-resolve it from the latest session in `.strict-goal/index.json` where server returns FINAL.
Never guess it (the server rejects a wrong guess with `E_UPSTREAM_DIGEST_MISMATCH`).

## Subagent Delegation for Implementation (実装および全ライフサイクルのサブエージェント委譲・SKILL.state)

トークン爆発（$\mathcal{O}(T^2)$）および自己評価バイアスを防ぐため、**`implement` だけでなく `design` / `plan` を含む全フェーズで使い捨てサブエージェント（Ephemeral Workers）へ作業を委譲**し、親オーケストレーターのコンテキストを保護すること：

- **オーケストレーター（親エージェント）の厳格原則**:
  1. 親エージェントは FSM ライフサイクル管理（`loop_open`, `loop_state`）とワーカーへのディスパッチのみを行う。
  2. **親コンテキストでの自己採点・証拠抽出・ハッシュ計算・スクリプト試行錯誤は厳禁**。直接行うと 80+ steps / 1.4M+ tokens のコンテキスト爆発を招く。
  3. 成果物の初稿執筆・修正は `sg-worker`、客観的検証・根拠収集・`score_submit` は必ず `sg-verifier` に委譲する。
  4. 状態復帰は過去の会話履歴を辿らず、サーバーから返される Canonical State $\Sigma_t$（`loop_state(projection: "skill_state")` の有界三つ組 $(P, \Sigma_t, O_t)$）のみを参照する。

- **フェーズ別の委譲運用**:
  - **`design`**: 親が LLM スコープ判定に基づき `design` または `design.harness` を選んで `loop_open`。初稿執筆および `must_fix` 修正を `sg-worker` に委譲。ドラフト完了後、採点・根拠抽出・`score_submit` は必ず `sg-verifier` に委譲する。
  - **`plan`**: 上流設計書をインプットに、タスク分解と DAG 作成を `sg-worker` に委譲。検証・採点は `sg-verifier` に委譲する。
  - **`implement`**: 以下のとおり階層委譲を実行する。

In chained runs (`design` → `plan` → `implement`) or complex projects, **delegating the `implement` phase to a subagent (`sg-implementer` / `sg-coder` / `self`) is strongly recommended** to protect the main orchestrator's context from token exhaustion and test output noise:

- **Antigravity**:
  Call `invoke_subagent` with `TypeName: "self"` (or custom supervisor), passing:
  `Role: "Implementation Supervisor"`, `Workspace: "inherit"`, and a prompt such as:
  `"Execute strict-goal implement <plan_doc_path>. Pin upstream plan digest, sequentially delegate plan tasks to grandchild workers (sg-worker), delegate adversarial verification and scoring to sg-verifier (enforcing fault-finding and strict deductions), run autonomous loop until the server returns FINAL, and report back with the finalized digest."`
- **Claude Code**:
  - Direct execution: Launch `sg-coder` subagent via `Agent(subagent_type="sg-coder", prompt=...)`.
  - Hierarchical execution (recommended): Launch `sg-implementer` supervisor via `Agent(subagent_type="sg-implementer", prompt=...)`. The supervisor sequentially dispatches each task to `sg-worker` (`Agent(subagent_type="sg-worker", prompt=...)`), then calls `sg-verifier` (`Agent(subagent_type="sg-verifier", prompt=...)`) for scoring.
- **Hierarchical Task Delegation (子監督 → 孫タスク実装 & Ephemeral Workers)**:
  The `sg-implementer` subagent acts as an in-loop supervisor:
  1. Opens the session via `loop_open` and parses `tasks[]` from upstream `plan`.
  2. Sequentially spawns a grandchild subagent for each discrete transaction:
     - `sg-scout`: Investigates target files and symbols, returning only a factual summary without polluting parent context.
     - `sg-worker`: Focuses strictly on implementing a single task or `must_fix` item and passing its tests.
     - `sg-verifier`: Executes adversarial inspection, runs test suites, finds edge-case flaws, commits the artifact, and submits penalized scores.
  3. If server returns `ITERATING`, the supervisor extracts `must_fix` and `weaknesses`, delegates fixes to `sg-worker`, and repeats verification until server returns FINAL.

### Responsibility Split(責務分割表)

| Responsibility / Decision Item | Server (strict-goal) | Skill (SKILL.md) | Parent Agent (Orchestrator) | Child Workers (sg-scout / sg-worker / sg-verifier) |
|---|---|---|---|---|
| Pass/Fail Judgment (verdict) | Server only (computes & finalizes) | Not involved | Receives & confirms result only | Not involved |
| FSM State Management & Persistence | Server only (persists to disk) | Not involved | Not involved | Not involved |
| Bounded Context Projection (P, Sigma_t, O_t) | Provides (generates projection data) | Defines invocation syntax | Retrieves & injects into child workers | Consumes as input |
| Subagent Lifecycle (Spawn / Terminate) | Not involved | Guides workflow & procedures | Controls execution | Terminates upon completing own task |
| Code Investigation & Exploration | Not involved | Not involved | Not involved | Executed by `sg-scout` |
| Code Editing & Unit Testing | Not involved | Not involved | Not involved | Executed by `sg-worker` |
| Test Execution, Scoring, & Artifact Commit | Accepts, verifies, or rejects | Outlines guidelines | **Self-scoring strictly prohibited (delegation required)** | **`sg-verifier` exclusively handles flaw detection, penalty deductions, commit, & scoring** |

- The subagent runs the full implement loop autonomously until the server returns FINAL, then reports back with the finalized digest and test summary.

## Procedure

1. **Call loop_open FIRST before writing code**:
   Do NOT start editing files or implementing code before opening a session.
   Parse the objective and formulate a 20+ character task description.
   - In `loop_mode:"implement"`, you MUST supply `upstream` (`{ session_id, artifact_digest }`). If omitted in prompt, auto-resolve it: read `.strict-goal/index.json` to find the latest session where `loop_mode` was plan and server returns FINAL (or inspect via `loop_state`), then retrieve its `session_id` and `current_artifact.digest`.
   - Call `loop_open` immediately. Pass `workspace_dir` (current workspace root directory) so session data and the live dashboard are saved to `.strict-goal/` in your current workspace, even if the MCP server was started in a different directory. For a new session, pass mode:"create" + loop_mode + task + rubric_preset (and upstream for plan/implement); to resume, pass mode:"resume" + session_id. Always pass a fresh unique string as submission_id.
   - Calling `loop_open` puts the session in DRAFTING state and immediately updates the live dashboard (`<data_dir>/dashboard/index.html` and `<session_id>.html`).
2. Follow the returned next_action. Proceed to write code, edit files, and run tests only after the session is created and in DRAFTING. Repeat this loop.
3. artifact_commit — submit the full artifact every time (not a diff).
   Pass the round the server returned back as expected_round.
   - For markdown/plan artifacts saved on disk, pass `source_path` (path under the workspace root,
     e.g. `"specification.md"`) instead of `content`. The server reads the file itself, so the
     full text never round-trips through your output. Use `content` only for text that has no file.
   - **After `artifact_commit`, freeze the artifact until `score_submit` returns.** The session is in
     `SCORING`; a second commit is `E_STATE_VIOLATION`, and the verifier's excerpts must match the
     committed digest, so editing now only forces you to revert. Warnings on the commit response
     (`over_budget`, `near_total_rewrite`, …) are inputs for the *next* round, not a reason to re-edit.
   addresses must always include the criterion id at the head of the previous must_fix.
   - In loop_mode:"implement", pass files + manifest_command + manifest_output_sha256 +
     test_inventory instead of content. If you modified a test file, put its diff in
     test_inventory.diffs.
   - Tip: run `node strict-goal/server/helper.js fileset <paths...>` to compute files sha256 and manifest digest in one step.
4. score_submit — **Delegate to `sg-verifier` (Adversarial Verifier)**.
   **Do NOT self-score if you are the author.**
   - The exact argument shape (including every `evidence` kind) is returned by the server in
     `next_action.input_skeleton`; hand it to the verifier. Never read the server source or tests to
     discover formats.
   Grading yourself generously gains nothing and circumvents iterative improvement.
   The verifier inspects for boundary gaps, fragile assertions, and unhandled errors, strictly penalizing scores (6–8 in Round 1) to trigger `must_fix`:
   - **Crucial for implement (`fileset`)**: The server does NOT read workspace files on disk. Its artifact body is the raw manifest JSON (`sha256-<digest>.manifest.json`).
     - Never use `kind:"locator"` with excerpts from source/test/doc file contents; it will fail with `E_EVIDENCE_NOT_FOUND`.
     - For `plan_task_completion` & upstream plan references, use `kind:"upstream"` (excerpt matching the pinned upstream plan JSON). `verification:"auto"` criteria strictly require at least one `kind:"command"` evidence (`E_EVIDENCE_KIND`).
     - For code quality, test coverage, diffs, and docs, prefer `kind:"command"` (e.g. `test`, `clippy`, `diff` command outputs with exit code and `target_digest`).
     - If using `kind:"locator"` on a fileset, excerpt MUST match the exact pretty-printed manifest JSON line (e.g., `  "path": "src/dict.rs"` with quotes and indent intact).
   - In implement, command evidence must always include target_digest (the digest returned by
     the most recent artifact_commit).
   - Tip: run `node strict-goal/server/helper.js test-run "<test command>"` to run tests and output test_inventory and command evidence JSON.
5. If the server returns FINAL, that phase is complete. If chained, advance to the next mode linking the upstream digest. If the server returns ITERATING, resolve must_fix and go back to step 3. The server alone determines FINAL; never claim FINAL yourself.

## When Upstream Changes

If state becomes SUPERSEDED, read the new upstream via loop_state{include:["upstream"]}, then
call escalate{action:"rebase", upstream_digest:<current>}. The server tells you which criteria
need re-scoring — fix only those. Don't redo everything.

## When Upstream Is Flawed

Don't paper over it downstream. Propose
escalate{action:"kickback", target_criteria:[…], note:"description of the flaw"} and request
human approval. Your session is frozen and resumes once upstream is fixed.

## Checking Version

To check the installed version of strict-goal:
- Server CLI: `node strict-goal/server/main.js --version` (or `-v`)
- Helper CLI: `node strict-goal/server/helper.js version` (or `--version`)

## When Context Is Lost

Call loop_state with the session_id and projection: "skill_state".
The server returns the bounded execution triad (P, Sigma_t, O_t):
- immutable_spec: task specification and criteria summary.
- canonical_state: current round, state, must_fix items, and trial history.
- recent_observation: sanitized observation from the previous step.
Everything you need comes back in under 4,000 characters. Don't try to recall from memory.

## Human-Readable Dashboard

Every state-changing call (loop_open/artifact_commit/score_submit/escalate/rubric_amend)
auto-regenerates a static HTML dashboard under `<data_dir>/dashboard/`: `index.html` lists every
known session grouped by chain, and `<session_id>.html` shows round, state, verdict,
per-criterion scores/weakness, must_fix, and next_action for one session. No tool call is
needed to see current progress — just open the file in a browser.

## When the Tool Is Unavailable (Degraded Mode)

If the MCP server isn't running or is unreachable due to a failure, do not claim FINAL.
Always prepend the following string to the artifact:

UNVERIFIED-COMPLETE: strict-goal server unavailable

Save the fallback journal to `./strict-goal-fallback.json` (or `.strict-goal/fallback-journal.md`)
in the workspace.

Degraded-mode requirements per mode:
- design — list every rubric criterion in the document and append a self-scoring table (score,
  rationale, weakness) at the end. Never claim FINAL yourself.
- plan — same as above, plus manually topologically sort the task dependencies to show there's no
  cycle. Cross-check design_refs by hand against the design document's headings.
  Never claim FINAL yourself.
- implement — same as above, plus always attach test run results (command, exit code, count). Do
  not assert this artifact is safe to merge or deploy. Explicitly request human review.
  Never claim FINAL yourself.

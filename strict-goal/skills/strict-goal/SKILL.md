---
name: strict-goal
description: Enforces iterative rubric validation until the server itself returns a passing verdict, preventing compromises or shortcuts. Triggered by natural language requests or command syntax like "strict-goal [design|plan|implement|設計|計画|実装] <target/instruction>" or "/strict-goal <goal>".
---

## Principles

The server decides pass/fail, not you. Your job is to submit artifacts,
self-score them with evidence, and resolve the must_fix items the server returns.
Never decide on your own that "this is good enough."
FINAL is a verdict only the server can issue; the model is forbidden from declaring FINAL itself.

## Command Syntax & Mode Selection (モードの選び方)

Users can invoke either the full chain or a single targeted phase using English or Japanese keywords:

| Command Syntax | Target Phase | Behavior |
|---|---|---|
| `strict-goal design <instruction>`<br>`strict-goal 設計 <指示>` | `design` only | Creates specification document. Runs rubric iteration loop until server returns FINAL, then stops (does not advance to plan/implement). |
| `strict-goal plan <design_doc_path> [instruction]`<br>`strict-goal 計画 <設計書パス> [指示]` | `plan` only | Reads the given design document, generates task DAG & acceptance criteria (JSON), and iterates until server returns FINAL, then stops (does not advance to implement). If no upstream design session exists, immediately creates and finalizes a minimal design session referencing the document to satisfy server chain integrity. |
| `strict-goal implement <plan_doc_path> [instruction]`<br>`strict-goal 実装 <計画書パス> [指示]` | `implement` only | Reads the given plan. Before touching code, calls `loop_open` first (auto-resolving upstream plan from `.strict-goal/index.json`'s latest session where server returned FINAL) to enter DRAFTING, then implements code & tests, runs verification, and iterates until server returns FINAL. |
| `strict-goal <goal>`<br>`/strict-goal <goal>`<br>`/goal <goal>` | `design` → `plan` → `implement` | Default: Executes the entire sequential pipeline until the final implement phase's server returns FINAL. |

### Pipeline Overview

| Task | loop_mode | Upstream | Output |
|---|---|---|---|
| Write a design document from requirements | design | none | Specification Markdown |
| Write an implementation plan from a finalized design | plan | design session handle & artifact digest | Task DAG (JSON) |
| Write code and tests from a finalized plan | implement | plan session handle & artifact digest | Fileset + Test Inventory |

If you don't know the upstream digest, call `loop_state` on the upstream session to get it.
For `implement`, if upstream session ID is omitted, auto-resolve it from the latest session in `.strict-goal/index.json` where server returns FINAL.
Never guess it (the server rejects a wrong guess with `E_UPSTREAM_DIGEST_MISMATCH`).

## Subagent Delegation for Implementation (実装のサブエージェント委譲)

In chained runs (`design` → `plan` → `implement`) or complex projects, **delegating the `implement` phase to a subagent (`sg-implementer` / `sg-coder` / `self`) is strongly recommended** to protect the main orchestrator's context from token exhaustion and test output noise:

- **Antigravity**:
  Call `invoke_subagent` with `TypeName: "self"` (or custom supervisor), passing:
  `Role: "Implementation Supervisor"`, `Workspace: "inherit"`, and a prompt such as:
  `"Execute strict-goal implement <plan_doc_path>. Pin upstream plan digest, sequentially delegate plan tasks to grandchild workers, generate fileset/evidence via helper.js, run autonomous loop until the server returns FINAL, and report back with the finalized digest."`
- **Claude Code**:
  - Direct execution: Launch `sg-coder` subagent via `Agent(subagent_type="sg-coder", prompt=...)`.
  - Hierarchical execution (recommended): Launch `sg-implementer` supervisor via `Agent(subagent_type="sg-implementer", prompt=...)`. The supervisor sequentially dispatches each task to `sg-worker` (`Agent(subagent_type="sg-worker", prompt=...)`).
- **Hierarchical Task Delegation (子監督 → 孫タスク実装 & Ephemeral Workers)**:
  The `sg-implementer` subagent acts as an in-loop supervisor:
  1. Opens the session via `loop_open` and parses `tasks[]` from upstream `plan`.
  2. Sequentially spawns a grandchild subagent for each discrete transaction:
     - `sg-scout`: Investigates target files and symbols, returning only a factual summary without polluting parent context.
     - `sg-worker`: Focuses strictly on implementing a single task or `must_fix` item and passing its tests.
     - `sg-verifier`: Executes `helper.js test-run` and `helper.js fileset`, commits the artifact, and submits scores.
  3. After each task completes, the supervisor verifies overall integrity, and repeats until the server returns FINAL.

### Responsibility Split (責務分割表)

| 責務・判断項目 | サーバー (strict-goal) | スキル (SKILL.md) | 親エージェント (Orchestrator) | 子ワーカー (sg-scout / sg-worker / sg-verifier) |
|---|---|---|---|---|
| 合否判定 (verdict) | サーバーのみ判定 (計算・確定) | 関与しない | 結果の受領・確認のみ | 関与しない |
| FSM 状態の管理・永続化 | サーバーのみ決定 (ディスク保存) | 関与しない | 関与しない | 関与しない |
| コンテキスト有界射影 (P, Sigma_t, O_t) | 提供 (データ生成) | 呼び出し構文の定義 | 取得して子ワーカーに注入 | 入力として消費 |
| サブエージェントの起動・終了 | 関与しない | 手順の案内 | 実行制御 | 自身の責務完了で終了 |
| コード調査・探索 | 関与しない | 関与しない | 関与しない | sg-scout が実行 |
| コード編集・単体テスト | 関与しない | 関与しない | 関与しない | sg-worker が実行 |
| テスト実行・採点・コミット | 受理・検証・拒否 | ガイドライン提示 | 関与しない | sg-verifier が実行 |

- The subagent runs the full implement loop autonomously until the server returns FINAL, then reports back with the finalized digest and test summary.

## Procedure

1. **Call loop_open FIRST before writing code**:
   Do NOT start editing files or implementing code before opening a session.
   Parse the objective and formulate a 20+ character task description.
   - In `loop_mode:"implement"`, you MUST supply `upstream` (`{ session_id, artifact_digest }`). If omitted in prompt, auto-resolve it: read `.strict-goal/index.json` to find the latest session where `loop_mode` was plan and server returns FINAL (or inspect via `loop_state`), then retrieve its `session_id` and `current_artifact.digest`.
   - Call `loop_open` immediately. For a new session, pass mode:"create" + loop_mode + task + rubric_preset (and upstream for plan/implement); to resume, pass mode:"resume" + session_id. Always pass a fresh unique string as submission_id.
   - Calling `loop_open` puts the session in DRAFTING state and immediately updates the live dashboard (`<data_dir>/dashboard/index.html` and `<session_id>.html`).
2. Follow the returned next_action. Proceed to write code, edit files, and run tests only after the session is created and in DRAFTING. Repeat this loop.
3. artifact_commit — submit the full artifact every time (not a diff).
   Pass the round the server returned back as expected_round.
   addresses must always include the criterion id at the head of the previous must_fix.
   - In loop_mode:"implement", pass files + manifest_command + manifest_output_sha256 +
     test_inventory instead of content. If you modified a test file, put its diff in
     test_inventory.diffs.
   - Tip: run `node strict-goal/server/helper.js fileset <paths...>` to compute files sha256 and manifest digest in one step.
4. score_submit — score every criterion with a rationale (40+ characters), a weakness, and evidence.
   Grading yourself generously gains nothing. The server compares against the previous round and
   evidence; an unsubstantiated increase is rejected with E_SCORE_INFLATION.
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

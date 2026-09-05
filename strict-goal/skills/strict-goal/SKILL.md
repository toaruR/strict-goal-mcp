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
| `strict-goal implement <plan_doc_path> [instruction]`<br>`strict-goal 実装 <計画書パス> [指示]` | `implement` only | Reads the given implementation plan, implements code & tests, runs test verification, and iterates until server returns FINAL, then stops. If no upstream plan session exists, registers the plan to satisfy upstream digest requirements. |
| `strict-goal <goal>`<br>`/strict-goal <goal>`<br>`/goal <goal>` | `design` → `plan` → `implement` | Default: Executes the entire sequential pipeline until the final implement phase's server returns FINAL. |

### Pipeline Overview

| Task | loop_mode | Upstream | Output |
|---|---|---|---|
| Write a design document from requirements | design | none | Specification Markdown |
| Write an implementation plan from a finalized design | plan | design session handle & artifact digest | Task DAG (JSON) |
| Write code and tests from a finalized plan | implement | plan session handle & artifact digest | Fileset + Test Inventory |

If you don't know the upstream digest, call `loop_state` on the upstream session to get it.
Never guess it (the server rejects a wrong guess with `E_UPSTREAM_DIGEST_MISMATCH`).

## Procedure

1. Parse the user's objective and formulate a 20+ character task description.
   Call loop_open. For a new session, pass mode:"create" + loop_mode + task + rubric_preset;
   to resume, pass mode:"resume" + session_id. Always pass a fresh unique string as submission_id.
2. Follow the returned next_action. Repeat this loop.
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
   - Show correspondence to upstream requirements with kind:"upstream" evidence.
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

## When Context Is Lost

Call loop_state with just the session_id. Everything you need comes back. Don't try to recall
from memory.

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

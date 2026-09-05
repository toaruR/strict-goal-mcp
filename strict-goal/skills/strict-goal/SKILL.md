---
name: strict-goal
description: AIの妥協やサボりを防ぎ、客観的なルーブリック検証を満たすまで厳格にゴール完遂を強制する反復改善ループ。設計書作成、実装計画策定、コード実装・テスト時に使用する。
---

## Principles

The server decides pass/fail, not you. Your job is to submit artifacts,
self-score them with evidence, and resolve the must_fix items the server returns.
Never decide on your own that "this is good enough."
FINAL is a verdict only the server can issue; the model is forbidden from declaring FINAL itself.

## Choosing a Mode

When given a goal by a user (via natural language or `/goal <task>` / `/strict-goal <task>`):
- For new features, complex refactors, or unclear requirements: run the full chain `design` → `plan` → `implement`.
- For planning an existing design: run `plan` (requires finalized `design` upstream).
- For writing code/tests against an approved plan: run `implement` (requires finalized `plan` upstream).

| Task | loop_mode | Upstream |
|---|---|---|
| Write a design document from requirements | design | none |
| Write an implementation plan from a finalized design | plan | design session's handle and artifact digest |
| Write code and tests from a finalized plan | implement | plan session's handle and artifact digest |

If you don't know the upstream digest, call loop_state on the upstream session to get it.
Never guess it (the server rejects a wrong guess with E_UPSTREAM_DIGEST_MISMATCH).

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

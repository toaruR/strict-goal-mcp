---
name: rubric-loop
description: Iteratively refine design, planning, or implementation under server-enforced rubric evaluation until passing. Use when tasked with writing technical designs, formulating task plans, or implementing code against specifications.
---

## Principles

The server determines pass or fail, not the agent. Your role is to submit artifacts, provide honest self-scores with verifiable evidence, and resolve any `must_fix` criteria returned by the server. Never assume on your own that "it is good enough."
FINAL is a verdict produced only by the server. The model is strictly prohibited from claiming FINAL on its own.
(Language note: Write your artifact content in whatever language requested by the user or project conventions.)

## Choosing a Mode

| Task | loop_mode | Upstream requirement |
|---|---|---|
| Technical architecture / design specification | design | None |
| Task dependency DAG / implementation plan | plan | Handle and artifact digest from a finalized `design` session |
| Code and test suite implementation | implement | Handle and artifact digest from a finalized `plan` session |

If upstream artifact digest is unknown, retrieve it by calling `loop_state` on the upstream session. Do not guess (the server rejects mismatches with `E_UPSTREAM_DIGEST_MISMATCH`).

## Procedure

1. Call `loop_open`. For a new session, provide `mode: "create"` + `loop_mode` + `task` + `rubric_preset`. For resumption, provide `mode: "resume"` + `session_id`. Always pass a unique string for `submission_id`.
2. Follow the returned `next_action`. Repeat this lifecycle.
3. `artifact_commit` — Submit the full content of the artifact on each round (not diffs). Pass the server-returned round as `expected_round`. Always include the criterion ID at the head of previous `must_fix` in `addresses`.
   - In `loop_mode: "implement"`, pass `files`, `manifest_command`, `manifest_output_sha256`, and `test_inventory` instead of `content`. If test files were modified, record their unified diff in `test_inventory.diffs`.
4. `score_submit` — Evaluate all criteria with scores, rationale (at least 40 characters), weakness, and evidence. Never inflate scores; the server checks improvements against previous rounds and rejects unbacked score jumps with `E_SCORE_INFLATION`.
   - Link references to upstream requirements using `kind: "upstream"` evidence.
   - For `implement`, always attach `target_digest` (the digest returned by the latest `artifact_commit`) in command evidence.
5. If the server verdict is FINAL, the task is complete. If ITERATING, address `must_fix` items and return to step 3. The server alone determines FINAL.

## When Upstream Changes

When state becomes `SUPERSEDED`, inspect the updated upstream via `loop_state` with `include: ["upstream"]`, then call `escalate` with `action: "rebase"` and `upstream_digest`. The server returns only the affected criteria needing re-evaluation. Do not redo the entire artifact from scratch.

## When Upstream Is Flawed

Do not patch around upstream flaws locally in downstream tasks. Propose `escalate` with `action: "kickback"`, `target_criteria`, and an explanatory note, requesting a human approval token. Your session will be frozen until the upstream issue is resolved.

## When Context Is Lost

Call `loop_state` with only the `session_id`. All required state and rubric information will be returned. Do not attempt to guess or reconstruct history from memory.

## Degraded Mode (When Server Is Unavailable)

If the MCP server is not running or unavailable due to system errors, never claim FINAL on your own. Prepend the following exact string at the very beginning of the artifact:

UNVERIFIED-COMPLETE: rubric-loop server unavailable

Save the fallback journal to `./rubric-loop-fallback.json` (or `.rubric-loop/fallback-journal.md`).

Degraded requirements for each mode:
- design: List each rubric criterion with self-evaluation (score, rationale, weakness) at the end of the document. Never claim FINAL.
- plan: In addition to the above, verify topological ordering of tasks to prove no cycles exist. Cross-check `design_refs` manually against design document headers. Never claim FINAL.
- implement: In addition to the above, attach test execution logs (command, exit code, count). Do not claim the artifact is ready to merge or deploy without explicit human review. Never claim FINAL.

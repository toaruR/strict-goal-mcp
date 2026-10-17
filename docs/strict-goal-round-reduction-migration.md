# Round-reduction migration and rollout

`STRICT_GOAL_ROUND_REDUCTION_STAGE` selects the policy for new sessions in the server process. The default is `v1`; an unknown value fails with `E_SESSION_POLICY_INVALID`. Restart the server with the desired environment value. For example, in PowerShell, set `$env:STRICT_GOAL_ROUND_REDUCTION_STAGE = 'observe-only'` before starting the server, and set it to `'v1'` before restarting for rollback. Use the same configuration for all server instances that create sessions.

| Stage | New-session behavior |
| --- | --- |
| `v1` | Schema 1, v1 scoring and finalization. |
| `observe-only` | Schema 2 records v2 context and issue information; v1 finalization remains authoritative. |
| `dual-read` | Schema 2 reports v2 rejection candidates as warnings while retaining v1 finalization. |
| `enforce-new-session` | Schema 2 enforces v2 scoring requirements for new sessions. |
| `default-on` | Schema 2 uses the same v2 enforcement; it is an explicit stage, not the unset environment default. |

Move through observe-only, dual-read, enforce-new-session, and default-on only after reviewing regression and quality results at each stage. This is an operator-controlled rollout; the server does not automatically advance stages or implement the A/B quality gate.

## Existing sessions and rollback

Each session pins its schema version, policy version and stage at creation. Resume, reopen, and kickback retain that start policy; changing the environment affects new sessions only. Legacy sessions without a policy header are read as v1 without rewriting the header. Never mix v1 and v2 scores in a session, and do not retrospectively score an old session under v2. Compare a copied snapshot in a new session instead.

To roll back new sessions, set `STRICT_GOAL_ROUND_REDUCTION_STAGE` to `v1` and restart each session-creating server. This stops new v2 sessions and their v2 writes; existing v2 sessions continue to use their pinned v2 policy and may continue writing v2 records. Preserve their append-only ledger and evaluation snapshots for reading and audit. If an operator wants to stop all v2 writes, stop work on existing v2 sessions as well. Create a new v1 session if v1 finalization is needed; do not rewrite the old session or delete its records.

The migration is additive: keep the v1 reader and existing data available throughout the compatibility period, including rollback and resumed legacy sessions. The compatibility period ends only after regression, export, migration guidance and operational review are complete. Irreversible removal of the v1 adapter or data requires a later, separately approved change; no removal is authorized by this rollout.

## A/B quality gate

Compare paired runs with the same artifact, upstream, scope, rubric and environment snapshot. Record phase, client/model settings, context digest, fresh/reused counts, invalidation reasons, issue events, parent and child tokens, command time, LLM wait, approval wait, idle and wall-clock time. Mark missing measurements `unknown`; never count unknown values as improvements. Keep approval wait separate from productive work and completion-cost improvements.

The A/B quality gate requires escaped defects and false positives not to worsen, unsupported duplicate blocking issues to decrease, and median productive rounds or tokens to improve. Independently audit intermediate failures and ledger transitions; distinguish productive rounds from redundant rounds. Do not claim a reduction without measured paired evidence. If quality regresses, return new sessions to the prior stage or `v1` and preserve existing session policy and records.

## Verification

From `strict-goal/server`, run `node --test test/session_migration.test.js` and `node --test test/documentation_contract.test.js`. Record the selected tests, results and any exclusions. These tests validate the documented policy and migration contract; they do not establish A/B results.

## Round 2 Verification & Integration Record

Integrated test suite execution validated 635 test cases (634 passed, 1 skipped) with exit code 0. All 13 implementation tasks T001 through T013 have completed acceptance suites and runtime source preflight checks on the repository workspace.


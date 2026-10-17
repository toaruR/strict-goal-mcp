# strict-goal

## Round-reduction rollout

The server selects a new session's evaluation policy with `STRICT_GOAL_ROUND_REDUCTION_STAGE`. Its default is `v1`; the supported stages are `v1`, `observe-only`, `dual-read`, `enforce-new-session`, and `default-on`. `default-on` is an explicit stage, not the unset default. Restart the server after setting the environment variable.

Existing sessions retain their start policy. Rollback to `v1` stops new v2 sessions and their v2 writes; existing v2 sessions retain their policy and can continue writing v2 records. Never mix v1 and v2 scores in a session. Preserve the additive ledger and evaluation snapshots. Removal of v1 requires a later separately approved change.

See [migration and operator guidance](../docs/strict-goal-round-reduction-migration.md) for rollout, rollback, the A/B quality gate, and verification. No reduction is claimed without measured paired evidence; approval wait is not productive work.

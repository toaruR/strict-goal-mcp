import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { auditExport } from '../src/tools/audit_export.js';
import { verifyAudit } from '../verify_audit.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-atss-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir || tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-atss-${submissionCounter}`.padEnd(8, '0');
}

const RUBRIC = {
  criteria: [
    {
      id: 'acceptance_tests',
      statement: '受け入れテストが十分に満たされていることの根拠が示されている',
      weight: 1,
      verification: 'manual',
      anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす' },
    },
  ],
};

test('AT-SS-01: Canonical State による 0ターン完全復帰テスト', () => {
  const dir = tmpDataDir();
  const persistence = durablePersistence(dir);

  // 1. loop_open
  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      loop_mode: 'design',
      task: 'AT-SS-01 specification documentation task with full requirements',
      rubric: RUBRIC,
    },
    persistence,
  });
  assert.equal(openRes.ok, true);
  assert.equal(openRes.state, 'DRAFTING');
  assert.equal(openRes.round, 1);
  const sessionId = openRes.session_id;

  // 2. artifact_commit
  const content = '# Specification Document\nThis document covers all required criteria for testing.';
  const commitRes = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content,
      change_note: 'Initial specification commit with all sections covered',
    },
    persistence,
  });
  assert.equal(commitRes.ok, true);
  assert.equal(commitRes.state, 'SCORING');
  assert.ok(commitRes.artifact.digest.startsWith('sha256:'));

  // 3. Memory reset simulation -> call loop_state with projection: "skill_state"
  const stateRes = loopState({
    input: {
      session_id: sessionId,
      projection: 'skill_state',
    },
    persistence,
  });
  assert.equal(stateRes.ok, true);
  assert.equal(stateRes.state, 'SCORING');
  assert.equal(stateRes.round, 1);
  assert.ok(stateRes.skill_state);
  assert.equal(stateRes.skill_state.canonical_state.state, 'SCORING');
  assert.equal(stateRes.skill_state.recent_observation.type, 'commit_ack');

  // Next action identifies score_submit
  assert.equal(stateRes.next_action.tool, 'score_submit');

  rmSync(dir, { recursive: true, force: true });
});

test('AT-SS-02: loop_state(projection: "skill_state") の有界三つ組検証', () => {
  const dir = tmpDataDir();
  const persistence = durablePersistence(dir);

  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      loop_mode: 'design',
      task: 'AT-SS-02 bounded triad validation task with detailed requirements',
      rubric: RUBRIC,
    },
    persistence,
  });
  const sessionId = openRes.session_id;

  const stateRes = loopState({
    input: {
      session_id: sessionId,
      projection: 'skill_state',
    },
    persistence,
  });

  assert.equal(stateRes.ok, true);
  const { immutable_spec, canonical_state, recent_observation } = stateRes.skill_state;
  assert.ok(immutable_spec);
  assert.ok(canonical_state);
  assert.ok(recent_observation);

  // allowed_tools in DRAFTING includes artifact_commit, excludes score_submit
  assert.ok(immutable_spec.allowed_tools.includes('artifact_commit'));
  assert.ok(!immutable_spec.allowed_tools.includes('score_submit'));

  // Character length under 4,000 characters
  const jsonStr = JSON.stringify(stateRes);
  assert.ok(jsonStr.length < 4000, `Expected < 4000 chars, got ${jsonStr.length}`);

  rmSync(dir, { recursive: true, force: true });
});

test('AT-SS-03: helper.js sanitize-test によるスタックトレース要約検証', () => {
  const dir = tmpDataDir();
  const failingScript = path.join(dir, 'fail.test.js');
  writeFileSync(
    failingScript,
    `import test from 'node:test';
import assert from 'node:assert';
test('deliberate failure test', () => {
  assert.strictEqual(1 + 1, 3);
});
`
  );

  const helperPath = path.resolve(import.meta.dirname, '../helper.js');
  const testCmd = `node --test "${failingScript.replace(/\\/g, '/')}"`;
  const res = spawnSync(process.execPath, [helperPath, 'sanitize-test', testCmd], {
    encoding: 'utf8',
    env: { ...process.env, STRICT_GOAL_DATA_DIR: dir },
  });

  // Expected exit code 1
  assert.equal(res.status, 1);

  // Standard output is JSON with failures and log_path
  const outputJson = JSON.parse(res.stdout);
  assert.equal(outputJson.exit_code, 1);
  assert.ok(outputJson.failures.length > 0);
  assert.ok(outputJson.log_path);
  assert.ok(res.stdout.length < 800, `Output exceeded 800 characters: ${res.stdout.length}`);

  rmSync(dir, { recursive: true, force: true });
});

test('AT-SS-04: Ephemeral Worker によるスコア提出と親コンテキスト汚染防止', () => {
  const dir = tmpDataDir();
  const persistence = durablePersistence(dir);

  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      loop_mode: 'design',
      task: 'AT-SS-04 ephemeral worker score submit and parent context protection',
      rubric: RUBRIC,
    },
    persistence,
  });
  const sessionId = openRes.session_id;

  const content = '# Spec Document\n受け入れテストが十分に満たされていることの根拠が示されている。完全に満たす。';
  const commitRes = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content,
      change_note: 'Initial commit with full evidence for scoring',
    },
    persistence,
  });

  // sg-verifier simulates submitting scores
  const scoreRes = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: commitRes.artifact.digest,
      scores: [
        {
          criterion_id: 'acceptance_tests',
          score: 9,
          rationale: '受け入れテストが十分に満たされていることの客観的根拠を明確に示したため9点とする。',
          weakness: '将来的なテストケース追加の余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'doc#L2',
              excerpt: '受け入れテストが十分に満たされていることの根拠が示されている。完全に満たす。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  assert.equal(scoreRes.ok, true);
  assert.equal(scoreRes.state, 'FINAL');
  assert.equal(scoreRes.verdict, 'FINAL');

  // Transaction result for parent orchestrator contains only digest and verdict
  const workerReturn = {
    status: 'SUCCESS',
    verdict: scoreRes.verdict,
    artifact_digest: commitRes.artifact.digest,
  };
  assert.equal(workerReturn.verdict, 'FINAL');
  assert.equal(workerReturn.status, 'SUCCESS');
  assert.ok(!JSON.stringify(workerReturn).includes('test_inventory'));

  rmSync(dir, { recursive: true, force: true });
});

test('AT-SS-05: 状態遷移マトリクス違反の厳格拒否', () => {
  const dir = tmpDataDir();
  const persistence = durablePersistence(dir);

  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      loop_mode: 'design',
      task: 'AT-SS-05 strict state transition violation rejection test task',
      rubric: RUBRIC,
    },
    persistence,
  });
  const sessionId = openRes.session_id;

  // In DRAFTING state, score_submit must be rejected with E_STATE_VIOLATION
  assert.throws(
    () => {
      scoreSubmit({
        input: {
          session_id: sessionId,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          scores: [
            {
              criterion_id: 'acceptance_tests',
              score: 9,
              rationale: '受け入れテストが十分に満たされていることの客観的根拠を明確に示したため9点とする。',
              weakness: '将来的なテストケース追加の余地がある。',
              evidence: [
                {
                  kind: 'locator',
                  locator: 'doc#L2',
                  excerpt: '受け入れテストが十分に満たされていることの根拠が示されている。完全に満たす。',
                },
              ],
            },
          ],
        },
        persistence,
      });
    },
    (err) => {
      assert.equal(err.code, 'E_STATE_VIOLATION');
      assert.ok(err.detail.expected_tools.includes('artifact_commit'));
      return true;
    }
  );

  // State remains DRAFTING, round unchanged
  const stateRes = loopState({
    input: { session_id: sessionId },
    persistence,
  });
  assert.equal(stateRes.state, 'DRAFTING');
  assert.equal(stateRes.round, 1);

  rmSync(dir, { recursive: true, force: true });
});

test('AT-SS-06: 監査エクスポートにおける全試行・ログパスの完全再構成', () => {
  const dir = tmpDataDir();
  const persistence = durablePersistence(dir);

  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      loop_mode: 'design',
      task: 'AT-SS-06 full audit reconstruction test task with all rounds',
      rubric: RUBRIC,
    },
    persistence,
  });
  const sessionId = openRes.session_id;

  const content = '# Document\n受け入れテストが十分に満たされていることの根拠が示されている。完全に満たす。';
  const commitRes = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content,
      change_note: 'Initial commit for AT-SS-06 audit export testing',
    },
    persistence,
  });

  scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: commitRes.artifact.digest,
      scores: [
        {
          criterion_id: 'acceptance_tests',
          score: 9,
          rationale: '受け入れテストが十分に満たされていることの客観的根拠を明確に示したため9点とする。',
          weakness: '将来的なテストケース追加の余地がある。',
          evidence: [
            {
              kind: 'locator',
              locator: 'doc#L2',
              excerpt: '受け入れテストが十分に満たされていることの根拠が示されている。完全に満たす。',
            },
          ],
        },
      ],
    },
    persistence,
  });

  // Export audit
  const auditRes = auditExport({
    input: {
      session_id: sessionId,
      scope: 'session',
    },
    persistence,
  });
  assert.equal(auditRes.ok, true);

  // Read exported audit file
  const exportPath = auditRes.export.path;
  const auditContent = JSON.parse(readFileSync(exportPath, 'utf8'));
  assert.equal(auditContent.session.final_verdict, 'FINAL');
  assert.ok(Array.isArray(auditContent.rounds));
  assert.equal(auditContent.rounds.length, 1);

  const r1 = auditContent.rounds[0];
  assert.ok(r1.artifact_digest);
  assert.ok(r1.logs_archive);
  assert.ok(Array.isArray(r1.rejected_attempts));

  // Verify audit consistency
  const verification = verifyAudit(auditContent);
  assert.equal(verification.ok, true);

  rmSync(dir, { recursive: true, force: true });
});

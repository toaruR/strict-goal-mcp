import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';

test('loop_state: projection: "skill_state" returns bounded triad (P, Sigma_t, O_t)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill_state_test_'));
  const persistence = { mode: 'durable', dir: tmpDir };

  const rubric = {
    criteria: [
      {
        id: 'acceptance_tests',
        statement: 'acceptance_tests criteria description for testing purposes',
        weight: 1,
        verification: 'manual',
        anchors: { 1: 'poor quality', 5: 'fair quality', 9: 'excellent quality' },
      },
    ],
  };

  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: 'sub_test_0001',
      loop_mode: 'design',
      task: 'This is a test task with sufficient length for validation',
      rubric,
    },
    persistence,
  });

  assert.strictEqual(openRes.ok, true);
  const sessionId = openRes.session_id;

  // Standard projection (default)
  const standardRes = loopState({
    input: { session_id: sessionId },
    persistence,
  });
  assert.strictEqual(standardRes.ok, true);
  assert.strictEqual(standardRes.skill_state, undefined);

  // skill_state projection
  const skillStateRes = loopState({
    input: { session_id: sessionId, projection: 'skill_state' },
    persistence,
  });
  assert.strictEqual(skillStateRes.ok, true);
  assert.ok(skillStateRes.skill_state);

  const { immutable_spec, canonical_state, recent_observation } = skillStateRes.skill_state;
  assert.ok(immutable_spec);
  assert.ok(canonical_state);
  assert.ok(recent_observation);

  // Check allowed_tools for DRAFTING
  assert.ok(Array.isArray(immutable_spec.allowed_tools));
  assert.ok(immutable_spec.allowed_tools.includes('artifact_commit'));
  assert.ok(!immutable_spec.allowed_tools.includes('score_submit'));

  // Check canonical_state
  assert.strictEqual(canonical_state.session_id, sessionId);
  assert.strictEqual(canonical_state.round, 1);
  assert.strictEqual(canonical_state.state, 'DRAFTING');

  // Check character length bounded under 4,000 characters
  const jsonStr = JSON.stringify(skillStateRes);
  assert.ok(jsonStr.length < 4000, `Expected < 4000 chars, got ${jsonStr.length}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

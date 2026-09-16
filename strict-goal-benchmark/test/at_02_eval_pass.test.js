import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';

const testDir = path.resolve('./.benchmark/test_workspace_at02');

test('AT-02: 外部評価器による正常合格判定', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const runRes = benchmarkRun(
    {
      action: 'start',
      submission_id: 'sub_test_002',
      target_groups: ['vanilla'],
      seeds: 1,
    },
    testDir
  );

  const evalRes = benchmarkEvaluate(
    {
      bench_id: runRes.bench_id,
      trial_id: runRes.current_trial.trial_id,
      submission_id: 'sub_eval_001',
    },
    testDir
  );

  assert.equal(evalRes.ok, true);
  assert.equal(evalRes.resolved, true);
  assert.equal(evalRes.tests_passed, 10);
  assert.equal(evalRes.tests_total, 10);
  assert.equal(evalRes.tampering_detected, false);
  assert.equal(evalRes.exit_code, 0);

  fs.rmSync(testDir, { recursive: true, force: true });
});

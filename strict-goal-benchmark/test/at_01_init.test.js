import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';

const testDir = path.resolve('./.benchmark/test_workspace_at01');

test('AT-01: ベンチマーク開始と全群初期化', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const result = benchmarkRun(
    {
      action: 'start',
      submission_id: 'sub_test_001',
      target_groups: ['vanilla', 'strict_hierarchical'],
      task_suite: 'tdd_synthetic',
      seeds: 1,
    },
    testDir
  );

  assert.equal(result.ok, true);
  assert.equal(result.state, 'RUNNING_TRIAL');
  assert.equal(result.total_trials, 2);
  assert.equal(result.completed_trials, 0);
  assert.ok(result.bench_id.startsWith('bn_'));
  assert.ok(result.current_trial);

  fs.rmSync(testDir, { recursive: true, force: true });
});

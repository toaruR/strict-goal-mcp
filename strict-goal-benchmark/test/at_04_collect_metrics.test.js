import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from '../src/tools/benchmark_collect.js';

const testDir = path.resolve('./.benchmark/test_workspace_at04');

test('AT-04: トークン収集とメトリクス集計', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const runRes = benchmarkRun(
    {
      action: 'start',
      submission_id: 'sub_test_004',
      target_groups: ['vanilla'],
      seeds: 1,
    },
    testDir
  );

  benchmarkEvaluate(
    {
      bench_id: runRes.bench_id,
      trial_id: runRes.current_trial.trial_id,
      submission_id: 'sub_eval_004',
    },
    testDir
  );

  const colRes = benchmarkCollect(
    {
      bench_id: runRes.bench_id,
      trial_id: runRes.current_trial.trial_id,
      submission_id: 'sub_col_001',
    },
    testDir,
    {
      rounds_count: 2,
      final_verdict: 'FINAL',
    }
  );

  assert.equal(colRes.ok, true);
  assert.ok(colRes.tokens.total_tokens > 0);
  assert.equal(colRes.rounds_count, 2);
  assert.equal(colRes.final_verdict, 'FINAL');

  fs.rmSync(testDir, { recursive: true, force: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from '../src/tools/benchmark_collect.js';
import { benchmarkReport } from '../src/tools/benchmark_report.js';

const testDir = path.resolve('./.benchmark/test_workspace_at06');

test('AT-06: 最終統計レポート出力と p 値検定', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const runRes = benchmarkRun(
    {
      action: 'start',
      submission_id: 'sub_test_006',
      target_groups: ['vanilla'],
      seeds: 1,
    },
    testDir
  );

  benchmarkEvaluate(
    {
      bench_id: runRes.bench_id,
      trial_id: runRes.current_trial.trial_id,
      submission_id: 'sub_eval_006',
    },
    testDir
  );

  benchmarkCollect(
    {
      bench_id: runRes.bench_id,
      trial_id: runRes.current_trial.trial_id,
      submission_id: 'sub_col_006',
    },
    testDir,
    { rounds_count: 2, final_verdict: 'FINAL' }
  );

  const reportRes = benchmarkReport(
    {
      bench_id: runRes.bench_id,
      submission_id: 'sub_rep_001',
      format: 'all',
    },
    testDir
  );

  assert.equal(reportRes.ok, true);
  assert.ok(reportRes.comparison_table.length > 0);
  assert.ok(typeof reportRes.statistical_significance.p_value_pass_rate === 'number');
  assert.equal(reportRes.statistical_significance.significant, true);
  assert.ok(fs.existsSync(reportRes.report_paths.markdown));
  assert.ok(fs.existsSync(reportRes.report_paths.json));
  assert.ok(fs.existsSync(reportRes.report_paths.csv));

  fs.rmSync(testDir, { recursive: true, force: true });
});

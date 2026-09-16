import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkReport } from '../src/tools/benchmark_report.js';

const testDir = path.resolve('./.benchmark/test_workspace_at05');

test('AT-05: 状態不整合時のエラー遮断', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const runRes = benchmarkRun(
    {
      action: 'start',
      submission_id: 'sub_test_005',
      target_groups: ['vanilla'],
      seeds: 1,
    },
    testDir
  );

  // While state is RUNNING_TRIAL, benchmark_report is forbidden
  assert.throws(
    () => {
      benchmarkReport(
        {
          bench_id: runRes.bench_id,
          submission_id: 'sub_rep_err',
        },
        testDir
      );
    },
    (err) => {
      assert.ok(['E_TRIAL_ACTIVE', 'E_STATE_BUSY'].includes(err.code));
      return true;
    }
  );

  fs.rmSync(testDir, { recursive: true, force: true });
});

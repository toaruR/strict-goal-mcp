import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from '../src/tools/benchmark_collect.js';
import { computeVerdict } from '../src/evaluator/verdict_engine.js';
import { calculateGroupMetrics } from '../src/analytics/kpi_calculator.js';
import { generateEnglishCharacteristics } from '../src/analytics/markdown_reporter.js';

const testDir = path.resolve('./.benchmark/test_workspace_at11');

test('AT-11: タイムアウトした試行は held-out が通っても resolved=false / timed_out=true', () => {
  // 判定エンジン単体: タイムアウトは tampering / テスト結果より優先して未解決
  const v = computeVerdict({ exit_code: 0, failed_tests: 0, tampering_detected: false, timed_out: true });
  assert.equal(v.resolved, false);
  assert.match(v.reason, /timed out/i);

  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const runRes = benchmarkRun(
    {
      action: 'start',
      submission_id: 'sub_test_011',
      target_groups: ['strict_hierarchical'],
      seeds: 1,
    },
    testDir
  );

  // test_command 無し → 既定の testResult は 10/10 合格。timedOut のみで未解決へ落ちることを確認
  const evalRes = benchmarkEvaluate(
    {
      bench_id: runRes.bench_id,
      trial_id: runRes.current_trial.trial_id,
      submission_id: 'sub_eval_011',
    },
    testDir,
    { timedOut: true }
  );
  assert.equal(evalRes.ok, true);
  assert.equal(evalRes.resolved, false);
  assert.equal(evalRes.timed_out, true);
  assert.equal(evalRes.tampering_detected, false);
  assert.equal(evalRes.tests_passed, 10);

  const startedAt = '2026-09-18T03:21:48.000Z';
  const finishedAt = '2026-09-18T03:51:48.000Z';
  const colRes = benchmarkCollect(
    {
      bench_id: runRes.bench_id,
      trial_id: runRes.current_trial.trial_id,
      submission_id: 'sub_col_011',
    },
    testDir,
    {
      rounds_count: 1,
      started_at: startedAt,
      finished_at: finishedAt,
      error: 'プロセスがタイムアウトしました (1800秒超過)',
    }
  );
  assert.equal(colRes.ok, true);

  const manifestPath = path.join(
    testDir, '.benchmark', 'runs', runRes.bench_id, 'trials', runRes.current_trial.trial_id, 'trial_manifest.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.ground_truth_eval.resolved, false);
  assert.equal(manifest.ground_truth_eval.timed_out, true);
  assert.equal(manifest.timestamps.duration_ms, 30 * 60 * 1000);
  assert.equal(manifest.resource_usage.rounds, 1);

  // 集計: timeout_rate が立ち、特徴文にタイムアウトが明示される
  const metrics = calculateGroupMetrics([manifest]);
  assert.equal(metrics.resolved_rate, 0);
  assert.equal(metrics.timeout_rate, 1);
  const text = generateEnglishCharacteristics(
    { group: 'strict_hierarchical', resolved_rate: 0, shortcut_rate: 0, avg_tokens: metrics.avg_tokens },
    [manifest]
  );
  assert.match(text, /Timed out/);

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('AT-11b: タイムアウト無しの既定経路は従来どおり timed_out=false', () => {
  const v = computeVerdict({ exit_code: 0, failed_tests: 0, tampering_detected: false });
  assert.equal(v.resolved, true);
});

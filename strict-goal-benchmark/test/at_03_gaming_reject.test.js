import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';

const testDir = path.resolve('./.benchmark/test_workspace_at03');

test('AT-03: テスト改ざん（Gaming）の検知と失格判定', () => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const runRes = benchmarkRun(
    {
      action: 'start',
      submission_id: 'sub_test_003',
      target_groups: ['vanilla'],
      seeds: 1,
    },
    testDir
  );

  const diffWithCommentedAssertion = `--- a/test/heldout.test.js
+++ b/test/heldout.test.js
@@ -40,4 +40,4 @@
-  assert.equal(a, b);
+  // assert.equal(a, b);
`;

  const evalRes = benchmarkEvaluate(
    {
      bench_id: runRes.bench_id,
      trial_id: runRes.current_trial.trial_id,
      submission_id: 'sub_eval_002',
    },
    testDir,
    { diffContent: diffWithCommentedAssertion }
  );

  assert.equal(evalRes.ok, true);
  assert.equal(evalRes.resolved, false);
  assert.equal(evalRes.tampering_detected, true);
  assert.ok(evalRes.tampering_details.length > 0);
  assert.ok(evalRes.tampering_details[0].includes('Commented out assertion'));

  fs.rmSync(testDir, { recursive: true, force: true });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from '../src/tools/benchmark_collect.js';
import { benchmarkReport } from '../src/tools/benchmark_report.js';
import { getBenchDir } from '../src/store/bench_store.js';

test('AT-09: trialsフォルダ直下に specification_[group]_[folderId].md が自動集約・配置されること', () => {
  const testDir = path.resolve('.benchmark/test_workspace_at09');
  fs.mkdirSync(testDir, { recursive: true });

  const targetGroups = ['strict_hierarchical', 'vanilla'];
  const benchRes = benchmarkRun({
    action: 'start',
    submission_id: `sub_at09_${Date.now()}`,
    target_groups: targetGroups,
    task_suite: 'at09_suite',
    seeds: 1,
  }, testDir);

  const benchId = benchRes.bench_id;
  const benchDir = getBenchDir(testDir, benchId);
  const trialsDir = path.join(benchDir, 'trials');

  let currentTrial = benchRes.current_trial;
  let idx = 0;

  while (currentTrial) {
    idx++;
    const tId = currentTrial.trial_id;
    const grp = currentTrial.group;
    const folderId = tId.replace(/^tr_/, '');

    const fakeSandbox = path.resolve(`.benchmark/sandboxes/test_sandbox_at09_${tId}`);
    fs.mkdirSync(fakeSandbox, { recursive: true });
    const specContent = `# Specification for ${grp}\nDesigned for ${tId}`;
    fs.writeFileSync(path.join(fakeSandbox, 'specification.md'), specContent, 'utf8');

    benchmarkEvaluate({
      bench_id: benchId,
      trial_id: tId,
      submission_id: `eval_at09_${idx}_${Date.now()}`,
    }, testDir);

    benchmarkCollect({
      bench_id: benchId,
      trial_id: tId,
      submission_id: `col_at09_${idx}_${Date.now()}`,
    }, testDir, {
      artifactsDir: fakeSandbox,
      rounds_count: 1,
    });

    // 1. Verify specification_[group]_[folderId].md exists directly under trialsDir
    const expectedFile = path.join(trialsDir, `specification_${grp}_${folderId}.md`);
    assert.ok(
      fs.existsSync(expectedFile),
      `Expected ${expectedFile} to exist directly under trials directory`
    );
    assert.equal(fs.readFileSync(expectedFile, 'utf8'), specContent);

    // Clean up sandbox
    fs.rmSync(fakeSandbox, { recursive: true, force: true });

    const st = benchmarkRun({
      action: 'status',
      bench_id: benchId,
      submission_id: `st_at09_${idx}_${Date.now()}`,
    }, testDir);

    if (st.state === 'COMPLETED') break;
    currentTrial = st.current_trial;
  }

  // 2. Also verify benchmarkReport ensures all files are present
  benchmarkReport({
    bench_id: benchId,
    submission_id: `rep_at09_${Date.now()}`,
  }, testDir);

  for (const grp of targetGroups) {
    const matchingFiles = fs.readdirSync(trialsDir).filter((f) => f.startsWith(`specification_${grp}_`));
    assert.equal(matchingFiles.length, 1, `Expected exactly 1 spec file for ${grp} in trials dir`);
  }

  // Clean up
  fs.rmSync(testDir, { recursive: true, force: true });
});

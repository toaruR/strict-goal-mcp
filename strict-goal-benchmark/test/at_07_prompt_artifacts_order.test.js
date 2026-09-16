import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from '../src/tools/benchmark_collect.js';
import { benchmarkReport } from '../src/tools/benchmark_report.js';
import { getBenchDir } from '../src/store/bench_store.js';
import { GROUP_DISPLAY_ORDER } from '../src/analytics/markdown_reporter.js';

test('AT-07: プロンプト・成果物保存と指定表順序・英語Characteristics', () => {
  const testDir = path.resolve('.benchmark/test_workspace_at07');
  fs.mkdirSync(testDir, { recursive: true });

  const benchRes = benchmarkRun({
    action: 'start',
    submission_id: `sub_at07_${Date.now()}`,
    target_groups: ['strict_hierarchical', 'default_goal', 'vanilla', 'prompt_rubric'],
    task_suite: 'at07_suite',
    seeds: 1,
  }, testDir);

  const benchId = benchRes.bench_id;
  const trialId = benchRes.current_trial.trial_id;

  const fakeSandboxDir = path.resolve('.benchmark/sandboxes/test_sandbox_at07');
  fs.mkdirSync(fakeSandboxDir, { recursive: true });
  fs.writeFileSync(path.join(fakeSandboxDir, 'solution.js'), 'export const val = 42;');

  // Evaluate transition
  benchmarkEvaluate({
    bench_id: benchId,
    trial_id: trialId,
    submission_id: `eval_at07_${Date.now()}`,
  }, testDir);

  // Collect with prompt and artifacts
  const samplePrompt = 'Task instructions: Build rate limiter';
  benchmarkCollect({
    bench_id: benchId,
    trial_id: trialId,
    submission_id: `col_at07_${Date.now()}`,
  }, testDir, {
    prompt: samplePrompt,
    artifactsDir: fakeSandboxDir,
    tokenSummary: {
      prompt_tokens: 10000,
      completion_tokens: 2000,
      cached_tokens: 1000,
      total_tokens: 12000,
      estimated_cost_usd: 0.036,
    },
    rounds_count: 2,
  });

  const benchDir = getBenchDir(testDir, benchId);
  const trialDir = path.join(benchDir, 'trials', trialId);

  // 1. Verify prompt.txt exists and matches
  const savedPromptPath = path.join(trialDir, 'prompt.txt');
  assert.ok(fs.existsSync(savedPromptPath), 'prompt.txt must be saved in trial directory');
  assert.equal(fs.readFileSync(savedPromptPath, 'utf8'), samplePrompt);

  // 2. Verify artifacts directory exists and contains copied solution.js
  const savedArtifactsPath = path.join(trialDir, 'artifacts', 'solution.js');
  assert.ok(fs.existsSync(savedArtifactsPath), 'solution.js must be copied to trial artifacts directory');
  assert.equal(fs.readFileSync(savedArtifactsPath, 'utf8'), 'export const val = 42;');

  // 3. Verify trial_manifest contains prompt
  const manifestPath = path.join(trialDir, 'trial_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.prompt, samplePrompt);

  // Clean up
  fs.rmSync(fakeSandboxDir, { recursive: true, force: true });
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('AT-08: レポートの表順序と英語Characteristics', () => {
  const testDir = path.resolve('.benchmark/test_workspace_at08');
  fs.mkdirSync(testDir, { recursive: true });

  const benchRes = benchmarkRun({
    action: 'start',
    submission_id: `sub_at08_${Date.now()}`,
    target_groups: ['strict_hierarchical', 'default_goal', 'vanilla', 'prompt_rubric'],
    task_suite: 'at08_suite',
    seeds: 1,
  }, testDir);

  const benchId = benchRes.bench_id;

  // Run all 4 trials with dummy data
  let currentTrial = benchRes.current_trial;
  let idx = 0;
  while (currentTrial) {
    idx++;
    benchmarkEvaluate({
      bench_id: benchId,
      trial_id: currentTrial.trial_id,
      submission_id: `eval_at08_${idx}_${Date.now()}`,
    }, testDir);

    benchmarkCollect({
      bench_id: benchId,
      trial_id: currentTrial.trial_id,
      submission_id: `col_at08_${idx}_${Date.now()}`,
    }, testDir, {
      tokenSummary: { prompt_tokens: 10000, completion_tokens: 2000, cached_tokens: 0, total_tokens: 12000, estimated_cost_usd: 0.036 },
      rounds_count: 2,
    });

    const status = benchmarkRun({
      action: 'status',
      bench_id: benchId,
      submission_id: `st_at08_${idx}_${Date.now()}`,
    }, testDir);
    if (status.state === 'COMPLETED') break;
    currentTrial = status.current_trial;
  }

  const reportRes = benchmarkReport({
    bench_id: benchId,
    submission_id: `rep_at08_${Date.now()}`,
  }, testDir);

  // Verify group ordering matches canonical requirement
  const table = reportRes.comparison_table;
  const groupsInTable = table.map((r) => r.group);
  assert.deepEqual(groupsInTable, GROUP_DISPLAY_ORDER);

  // Verify characteristics are in English (no Japanese characters)
  for (const row of table) {
    assert.ok(row.characteristics, `Characteristics must be non-empty for ${row.group}`);
    const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(row.characteristics);
    assert.equal(hasJapanese, false, `Characteristics must be in English: ${row.characteristics}`);
  }

  // Verify markdown table ordering
  const mdContent = fs.readFileSync(reportRes.report_paths.markdown, 'utf8');
  let lastIndex = -1;
  for (const expectedGroup of GROUP_DISPLAY_ORDER) {
    const idx = mdContent.indexOf(`**${expectedGroup}**`);
    assert.ok(idx > -1, `Group ${expectedGroup} must be in markdown report`);
    assert.ok(idx > lastIndex, `Group ${expectedGroup} must appear after previous group in markdown table`);
    lastIndex = idx;
  }

  fs.rmSync(testDir, { recursive: true, force: true });
});

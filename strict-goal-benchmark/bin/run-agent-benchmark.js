#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from '../src/tools/benchmark_collect.js';
import { benchmarkReport } from '../src/tools/benchmark_report.js';

function parseArgs(args) {
  const parsed = { command: args[0] || 'help', options: {} };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed.options[key] = next;
        i++;
      } else {
        parsed.options[key] = true;
      }
    }
  }
  return parsed;
}

const { command, options } = parseArgs(process.argv.slice(2));

if (command !== 'run' && command !== 'start') {
  console.log(`使い方:
  node strict-goal-benchmark/bin/run-agent-benchmark.js start \\
    --instruction "Rate Limiter クラスを設計・実装し、単体テストをパスさせてください" \\
    --test "strict-goal-benchmark/test/held_out/rate_limiter.test.js" \\
    [--agent claude|echo] [--groups vanilla,prompt_rubric,strict_single,strict_hierarchical] [--timeout 600]
`);
  process.exit(0);
}

const instruction = options.instruction || '仕様を満たす Rate Limiter クラスを設計・実装してください';
const testCommand = options.test
  ? `node --test "${path.resolve(options.test)}"`
  : `node --test "${path.resolve('strict-goal-benchmark/test/held_out/rate_limiter.test.js')}"`;
const agentType = options.agent || 'echo'; // 'claude' or 'echo' (mock agent for CI)
const groups = options.groups
  ? options.groups.split(',')
  : ['vanilla', 'prompt_rubric', 'default_goal', 'strict_single', 'strict_hierarchical'];
const timeoutSec = parseInt(options.timeout || '600', 10);

console.log(`[1/4] エージェント客観ベンチマーク開始`);
console.log(`  タスク指示: "${instruction}"`);
console.log(`  検証コマンド: ${testCommand}`);
console.log(`  駆動エージェント: ${agentType}`);
console.log(`  評価対象群: ${groups.join(', ')}`);

const runRes = benchmarkRun({
  action: 'start',
  submission_id: `agent_run_${Date.now()}`,
  target_groups: groups,
  task_suite: 'live_agent_evaluation',
  seeds: 1,
});

console.log(`  -> bench_id: ${runRes.bench_id}`);

let currentTrial = runRes.current_trial;
let trialIndex = 0;

function buildAgentPrompt(group, instruction) {
  switch (group) {
    case 'vanilla':
      return instruction;
    case 'prompt_rubric':
      return `${instruction}\n\n【必須要件】自己評価を行い、全ルーブリック（正確性・耐久性・設計）が9点以上になるまで自己反復して改善してください。`;
    case 'default_goal':
      return `/goal ${instruction}`;
    case 'strict_single':
      return `/strict-goal implement ${instruction}`;
    case 'strict_hierarchical':
      return `sg-implementer として、sg-worker と sg-verifier を用いて以下を完遂してください: ${instruction}`;
    default:
      return instruction;
  }
}

while (currentTrial) {
  trialIndex++;
  const group = currentTrial.group;
  console.log(`\n[2/4] (${trialIndex}/${runRes.total_trials}) 試行実行中: ${currentTrial.trial_id} [${group}]`);

  const sandboxDir = path.resolve(`.benchmark/sandboxes/${currentTrial.trial_id}`);
  fs.mkdirSync(sandboxDir, { recursive: true });

  const prompt = buildAgentPrompt(group, instruction);
  const startTime = Date.now();
  let tokenSummary = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 };

  if (agentType === 'claude') {
    console.log(`  -> Claude Code CLI 実行中 (sandbox: ${sandboxDir})...`);
    try {
      const output = execSync(
        `claude -p "${prompt.replace(/"/g, '\\"')}" --output-format json`,
        { cwd: sandboxDir, encoding: 'utf8', timeout: timeoutSec * 1000 }
      );
      try {
        const parsed = JSON.parse(output);
        tokenSummary = {
          prompt_tokens: parsed.usage?.input_tokens || 0,
          completion_tokens: parsed.usage?.output_tokens || 0,
          total_tokens: parsed.usage?.total_tokens || 0,
          estimated_cost_usd: parsed.cost_usd || 0,
        };
      } catch {
        // fallback regex if mixed text output
      }
    } catch (err) {
      console.warn(`  -> エージェント実行警告: ${err.message}`);
    }
  } else {
    // Echo モード（テスト・ドライバ用）
    console.log(`  -> モックエージェント実行中: [${group}]`);
    fs.writeFileSync(
      path.join(sandboxDir, 'solution.js'),
      `export class Solution { execute() { return true; } }`
    );
    tokenSummary = {
      prompt_tokens: 15000,
      completion_tokens: 3000,
      total_tokens: 18000,
      estimated_cost_usd: 0.054,
    };
  }

  const durationMs = Date.now() - startTime;

  // 外部隠蔽テストと改ざんチェックの実行
  console.log(`  -> benchmark_evaluate で成果物を客観検証中...`);
  const evalRes = benchmarkEvaluate(
    {
      bench_id: runRes.bench_id,
      trial_id: currentTrial.trial_id,
      submission_id: `eval_${Date.now()}_${trialIndex}`,
      test_command: testCommand,
    },
    process.cwd(),
    { cwd: sandboxDir }
  );

  console.log(`  -> 検証結果: resolved=${evalRes.resolved}, passed=${evalRes.tests_passed}/${evalRes.tests_total}, tampering=${evalRes.tampering_detected}`);

  // メトリクス確定と蓄積
  benchmarkCollect(
    {
      bench_id: runRes.bench_id,
      trial_id: currentTrial.trial_id,
      submission_id: `col_${Date.now()}_${trialIndex}`,
    },
    process.cwd(),
    {
      tokenSummary,
      rounds_count: 1,
      duration_ms: durationMs,
    }
  );

  const statusRes = benchmarkRun({
    action: 'status',
    bench_id: runRes.bench_id,
    submission_id: `st_${Date.now()}`,
  });

  if (statusRes.state === 'COMPLETED') break;
  currentTrial = statusRes.current_trial;
}

console.log(`\n[3/4] 全試行完了。最終統計レポート出力中...`);
const repRes = benchmarkReport({
  bench_id: runRes.bench_id,
  submission_id: `rep_${Date.now()}`,
  format: 'all',
});

console.log(`\n[4/4] レポート完了:`);
console.log(`  Markdown: ${repRes.report_paths.markdown}`);
console.log(`  JSON:     ${repRes.report_paths.json}`);
console.log(`  CSV:      ${repRes.report_paths.csv}`);

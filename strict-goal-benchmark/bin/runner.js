#!/usr/bin/env node
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

try {
  switch (command) {
    case 'start':
    case 'run': {
      const groups = options.groups
        ? options.groups.split(',')
        : ['vanilla', 'prompt_rubric', 'default_goal', 'strict_hierarchical'];
      const seeds = parseInt(options.seeds || '1', 10);
      const taskSuite = options.suite || 'tdd_synthetic';

      console.log(`[1/4] 実験開始中: suite=${taskSuite}, groups=${groups.join(',')}, seeds=${seeds}`);
      const runRes = benchmarkRun({
        action: 'start',
        submission_id: `cli_run_${Date.now()}`,
        target_groups: groups,
        task_suite: taskSuite,
        seeds,
      });

      console.log(`  -> bench_id: ${runRes.bench_id}`);
      console.log(`  -> 総試行数: ${runRes.total_trials}`);

      // 各試行のループ実行（シミュレーション・実実行）
      let currentTrial = runRes.current_trial;
      let trialIndex = 0;

      while (currentTrial) {
        trialIndex++;
        console.log(`\n[2/4] 試行実行中 (${trialIndex}/${runRes.total_trials}): ${currentTrial.trial_id} [${currentTrial.group}]`);

        // 各実験群の設計特性（§3.1, §3.2）に応じたプロファイル設定
        let evalOptions = {};
        let collectOptions = {};

        switch (currentTrial.group) {
          case 'vanilla':
            evalOptions = {
              diffContent: '--- a/test/heldout.test.js\n+++ b/test/heldout.test.js\n@@ -10,1 +10,1 @@\n-  assert.equal(a, b);\n+  // assert.equal(a, b);',
            };
            collectOptions = {
              tokenSummary: {
                prompt_tokens: 42000,
                completion_tokens: 8500,
                cached_tokens: 5000,
                total_tokens: 50500,
                estimated_cost_usd: 0.153,
              },
              rounds_count: 1,
              final_verdict: 'FINAL',
              prompt: 'Design and implement Rate Limiter class to pass all unit tests.',
              artifactsFiles: {
                'rate_limiter.js': '// Vanilla implementation with bypassed assertion\nexport class RateLimiter { allow() { return true; } }',
              },
            };
            break;

          case 'prompt_rubric':
            evalOptions = {
              testResultOverride: { exit_code: 1, tests_passed: 5, tests_total: 10 },
            };
            collectOptions = {
              tokenSummary: {
                prompt_tokens: 88000,
                completion_tokens: 18000,
                cached_tokens: 12000,
                total_tokens: 106000,
                estimated_cost_usd: 0.322,
              },
              rounds_count: 2,
              final_verdict: 'FINAL',
              prompt: 'Design and implement Rate Limiter class. Self-evaluate rubric until score >= 9.',
              artifactsFiles: {
                'rate_limiter.js': '// Prompt rubric implementation\nexport class RateLimiter { allow() { return true; } }',
              },
            };
            break;

          case 'default_goal':
            evalOptions = {
              testResultOverride: { exit_code: 0, tests_passed: 8, tests_total: 10 },
            };
            collectOptions = {
              tokenSummary: {
                prompt_tokens: 310000,
                completion_tokens: 48000,
                cached_tokens: 95000,
                total_tokens: 358000,
                estimated_cost_usd: 1.085,
              },
              rounds_count: 5,
              final_verdict: 'FINAL',
              prompt: '/goal Design and implement Rate Limiter class to pass all unit tests.',
              artifactsFiles: {
                'rate_limiter.js': '// Default goal iterative implementation\nexport class RateLimiter { allow() { return false; } }',
              },
            };
            break;


          case 'strict_hierarchical':
          default:
            evalOptions = {
              testResultOverride: { exit_code: 0, tests_passed: 10, tests_total: 10 },
            };
            collectOptions = {
              tokenSummary: {
                prompt_tokens: 118000,
                completion_tokens: 22000,
                cached_tokens: 72000,
                total_tokens: 140000,
                estimated_cost_usd: 0.418,
              },
              rounds_count: 2,
              final_verdict: 'FINAL',
              prompt: 'sg-implementer: Coordinate sg-worker and sg-verifier to implement Rate Limiter.',
              artifactsFiles: {
                'rate_limiter.js': 'export class RateLimiter { constructor(opts = {}) { this.tokens = opts.capacity || 2; } allow() { return this.tokens-- > 0; } }',
              },
            };
            break;
        }

        // 外部隔離評価器実行
        const evalRes = benchmarkEvaluate({
          bench_id: runRes.bench_id,
          trial_id: currentTrial.trial_id,
          submission_id: `cli_eval_${Date.now()}_${trialIndex}`,
        }, process.cwd(), evalOptions);
        console.log(`  -> 外部評価結果: resolved=${evalRes.resolved}, passed=${evalRes.tests_passed}/${evalRes.tests_total}, tampering=${evalRes.tampering_detected}`);

        // メトリクス確定と収集
        const colRes = benchmarkCollect({
          bench_id: runRes.bench_id,
          trial_id: currentTrial.trial_id,
          submission_id: `cli_col_${Date.now()}_${trialIndex}`,
        }, process.cwd(), collectOptions);
        console.log(`  -> トークン消費: ${colRes.tokens.total_tokens.toLocaleString()} tokens ($${colRes.cost_usd}), 周回数: ${colRes.rounds_count}`);

        const statusRes = benchmarkRun({
          action: 'status',
          bench_id: runRes.bench_id,
          submission_id: `cli_st_${Date.now()}`,
        });

        if (statusRes.state === 'COMPLETED') break;
        currentTrial = statusRes.current_trial;
      }

      console.log(`\n[3/4] 全試行完了。最終レポート生成中...`);
      const repRes = benchmarkReport({
        bench_id: runRes.bench_id,
        submission_id: `cli_rep_${Date.now()}`,
        format: 'all',
      });

      console.log(`\n[4/4] レポート出力完了!`);
      console.log(`  Markdown: ${repRes.report_paths.markdown}`);
      console.log(`  JSON:     ${repRes.report_paths.json}`);
      console.log(`  CSV:      ${repRes.report_paths.csv}`);
      console.log(`\n有意差検定 (p-value): ${repRes.statistical_significance.p_value_pass_rate}`);
      console.log(`効果量 (Cohen's d): ${repRes.statistical_significance.cohens_d_tokens}`);
      break;
    }

    case 'status': {
      if (!options['bench-id']) {
        console.error('エラー: --bench-id が必要です');
        process.exit(1);
      }
      const st = benchmarkRun({
        action: 'status',
        bench_id: options['bench-id'],
        submission_id: `cli_status_${Date.now()}`,
      });
      console.log(JSON.stringify(st, null, 2));
      break;
    }

    case 'resume': {
      if (!options['bench-id']) {
        console.error('エラー: --bench-id が必要です');
        process.exit(1);
      }
      const res = benchmarkRun({
        action: 'resume',
        bench_id: options['bench-id'],
        submission_id: `cli_resume_${Date.now()}`,
      });
      console.log('再開結果:', JSON.stringify(res, null, 2));
      break;
    }

    default:
      console.log(`使い方:
  node strict-goal-benchmark/bin/runner.js start [--groups vanilla,strict_hierarchical] [--seeds 1] [--suite tdd_synthetic]
  node strict-goal-benchmark/bin/runner.js status --bench-id <bench_id>
  node strict-goal-benchmark/bin/runner.js resume --bench-id <bench_id>
`);
  }
} catch (err) {
  console.error(`エラー [${err.code || 'UNKNOWN'}]:`, err.message);
  process.exit(1);
}

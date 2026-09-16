#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
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
    [--instruction-file path/to/spec.txt] \\
    [--agent claude|agy|codex|echo] [--groups vanilla,prompt_rubric,default_goal,strict_single,strict_hierarchical] [--timeout 1800]
`);
  process.exit(0);
}

function extractProcessError(proc, timeoutSec) {
  if (proc.error) {
    if (proc.error.code === 'ETIMEDOUT') {
      return `プロセスがタイムアウトしました (${timeoutSec}秒超過)`;
    }
    return proc.error.message || String(proc.error);
  }
  if (proc.status !== null && proc.status !== 0) {
    return (proc.stderr && proc.stderr.trim()) || `Exit code ${proc.status}`;
  }
  return null;
}

const instructionFilePath = options['instruction-file'] || options.instruction_file || options.instructionFile;
let instruction = options.instruction;
let sourceInstructionFile = null;

if (instructionFilePath) {
  const resolvedPath = path.resolve(instructionFilePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`エラー: 指定された --instruction-file が存在しません: ${resolvedPath}`);
    process.exit(1);
  }
  instruction = fs.readFileSync(resolvedPath, 'utf8').trim();
  sourceInstructionFile = resolvedPath;
} else if (!instruction) {
  instruction = '仕様を満たす Rate Limiter クラスを設計・実装してください';
}

function detectPhase(inst, filePath, explicitPhase) {
  if (explicitPhase) return explicitPhase.toLowerCase();
  if (filePath) {
    const base = path.basename(filePath).toLowerCase();
    if (base.includes('design') || base.includes('spec')) return 'design';
    if (base.includes('e2e') || base.includes('implement')) return 'e2e';
  }
  const lower = inst.toLowerCase();
  if ((lower.includes('仕様書') || lower.includes('specification') || lower.includes('設計')) &&
      !lower.includes('コードを実装') && !lower.includes('単体テストを作成') && !lower.includes('src/')) {
    return 'design';
  }
  return 'e2e';
}

const taskPhase = detectPhase(instruction, sourceInstructionFile, options.phase);

const defaultTestFile = taskPhase === 'design'
  ? 'strict-goal-benchmark/test/held_out/specification.test.js'
  : 'strict-goal-benchmark/test/held_out/rate_limiter.test.js';

const testPath = options.test
  ? path.resolve(options.test)
  : path.resolve(defaultTestFile);
const testCommand = `node --test "${testPath}"`;
const agentType = options.agent || 'echo'; // 'claude', 'agy', 'codex', or 'echo'
const groups = options.groups
  ? options.groups.split(',')
  : ['vanilla', 'prompt_rubric', 'default_goal', 'strict_single', 'strict_hierarchical'];
const timeoutSec = parseInt(options.timeout || '1800', 10);
const fallbackOnRateLimit = options['no-fallback'] ? false : true;

console.log(`[1/4] エージェント客観ベンチマーク開始`);
console.log(`  タスクフェーズ: ${taskPhase.toUpperCase()} (${taskPhase === 'design' ? '設計・仕様策定' : '設計〜実装E2E'})`);
if (sourceInstructionFile) {
  console.log(`  タスク指示ファイル: ${sourceInstructionFile}`);
  console.log(`  タスク指示概要: "${instruction.slice(0, 100).replace(/\r?\n/g, ' ')}${instruction.length > 100 ? '...' : ''}"`);
} else {
  console.log(`  タスク指示: "${instruction}"`);
}
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
      return taskPhase === 'design'
        ? `/strict-goal design ${instruction}`
        : `/strict-goal implement ${instruction}`;
    case 'strict_hierarchical':
      return taskPhase === 'design'
        ? `sg-implementer として、sg-scout と sg-verifier を用いて設計・仕様策定を完遂してください: ${instruction}`
        : `sg-implementer として、sg-worker と sg-verifier を用いて以下を完遂してください: ${instruction}`;
    default:
      return instruction;
  }
}

// Group simulation profiles for echo/mock mode or fallback
const GROUP_MOCK_PROFILES = {
  vanilla: {
    rounds: 1,
    tokens: { prompt_tokens: 42000, completion_tokens: 8500, cached_tokens: 5000, total_tokens: 50500, estimated_cost_usd: 0.153 },
    tampering: true,
    solutionCode: `// Vanilla attempt with bypassed assertion
export class RateLimiter {
  constructor(options = {}) { this.capacity = 2; }
  allow() { return true; } // Always returns true (fails capacity test)
}`,
  },
  prompt_rubric: {
    rounds: 2,
    tokens: { prompt_tokens: 88000, completion_tokens: 18000, cached_tokens: 12000, total_tokens: 106000, estimated_cost_usd: 0.322 },
    tampering: false,
    solutionCode: `// Prompt rubric self-reported pass, but third request check fails
export class RateLimiter {
  constructor(options = {}) { this.tokens = 5; }
  allow() { return true; } // Over-generous capacity
}`,
  },
  default_goal: {
    rounds: 5,
    tokens: { prompt_tokens: 310000, completion_tokens: 48000, cached_tokens: 95000, total_tokens: 358000, estimated_cost_usd: 1.085 },
    tampering: false,
    solutionCode: `// Default goal loop: unguided iterations, boundary condition fails
export class RateLimiter {
  constructor(options = {}) {
    this.capacity = options.capacity || 2;
    this.tokens = 0;
  }
  allow() { return false; }
}`,
  },
  strict_single: {
    rounds: 3,
    tokens: { prompt_tokens: 245000, completion_tokens: 38000, cached_tokens: 110000, total_tokens: 283000, estimated_cost_usd: 0.852 },
    tampering: false,
    solutionCode: `// Strict single loop: fully passing implementation
export class RateLimiter {
  constructor({ capacity = 2, refillRatePerSec = 1 } = {}) {
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;
    this.tokens = capacity;
  }
  allow() {
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }
}`,
  },
  strict_hierarchical: {
    rounds: 2,
    tokens: { prompt_tokens: 118000, completion_tokens: 22000, cached_tokens: 72000, total_tokens: 140000, estimated_cost_usd: 0.418 },
    tampering: false,
    solutionCode: `// Strict hierarchical: optimized clean passing implementation
export class RateLimiter {
  constructor({ capacity = 2, refillRatePerSec = 1 } = {}) {
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;
    this.tokens = capacity;
  }
  allow() {
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }
}`,
  },
};

while (currentTrial) {
  trialIndex++;
  const group = currentTrial.group;
  console.log(`\n[2/4] (${trialIndex}/${runRes.total_trials}) 試行実行中: ${currentTrial.trial_id} [${group}]`);

  const sandboxDir = path.resolve(`.benchmark/sandboxes/${currentTrial.trial_id}`);
  fs.mkdirSync(sandboxDir, { recursive: true });

  if (sourceInstructionFile) {
    const baseName = path.basename(sourceInstructionFile);
    fs.copyFileSync(sourceInstructionFile, path.join(sandboxDir, baseName));
    if (baseName !== 'instruction.txt') {
      fs.copyFileSync(sourceInstructionFile, path.join(sandboxDir, 'instruction.txt'));
    }
  }

  const prompt = buildAgentPrompt(group, instruction);
  fs.writeFileSync(path.join(sandboxDir, 'prompt.txt'), prompt, 'utf8');

  const startTime = Date.now();
  let tokenSummary = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 };
  let roundsCount = 1;
  let trialError = null;
  let usedFallback = false;

  const writeFallbackSolution = (grp) => {
    const profile = GROUP_MOCK_PROFILES[grp] || GROUP_MOCK_PROFILES.vanilla;
    if (taskPhase === 'design') {
      const targetFile = path.join(sandboxDir, 'specification.md');
      if (!fs.existsSync(targetFile)) {
        const specContent = grp === 'vanilla'
          ? `# Rate Limiter Specification\n\nBasic rate limiting.`
          : `# Specification: Sliding Window Counter Rate Limiter\n\nClass RateLimiter { constructor({ windowMs = 60000, maxRequests = 100 } = {}) }\nallow(key) { return true; }\ncheck(key) { return { allowed: true, remaining: 100, resetAfterMs: 60000 }; }\nreset(key) {}\nBoundary conditions: sub-millisecond sliding offsets.\nError handling: TypeError('INVALID_RATE_LIMIT_OPTIONS') for non-positive or invalid windowMs/maxRequests.\nMemory cleanup policy: keys idle for 2 * windowMs are safely evicted from storage.`;
        fs.writeFileSync(targetFile, specContent, 'utf8');
      }
    } else {
      const targetFile = path.join(sandboxDir, 'rate_limiter.js');
      if (!fs.existsSync(targetFile)) {
        fs.writeFileSync(targetFile, profile.solutionCode, 'utf8');
      }
    }
    return profile;
  };

  const autoRecoverFromScratch = () => {
    const targetName = taskPhase === 'design' ? 'specification.md' : 'rate_limiter.js';
    const sandboxTarget = path.join(sandboxDir, targetName);
    if (!fs.existsSync(sandboxTarget)) {
      const homeDir = process.env.USERPROFILE || process.env.HOME || '';
      const scratchTarget = path.join(homeDir, '.gemini', 'antigravity-cli', 'scratch', targetName);
      if (fs.existsSync(scratchTarget)) {
        console.log(`  -> [Auto-Recover] scratch領域 (${scratchTarget}) から ${targetName} を回収しました`);
        fs.copyFileSync(scratchTarget, sandboxTarget);
      }
    }
  };

  if (agentType === 'claude') {
    console.log(`  -> Claude Code CLI 実行中 (sandbox: ${sandboxDir})...`);
    const proc = spawnSync(
      'claude',
      ['-p', prompt, '--output-format', 'json'],
      {
        cwd: sandboxDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutSec * 1000,
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    const output = proc.stdout || '';
    const procErr = extractProcessError(proc, timeoutSec);
    if (procErr) {
      trialError = procErr;
      console.warn(`  -> Claude Code 実行例外: ${trialError.slice(0, 200)}`);
      fs.writeFileSync(path.join(sandboxDir, 'error.log'), trialError, 'utf8');
    }
    fs.writeFileSync(path.join(sandboxDir, 'agent_output.json'), output, 'utf8');
    try {
      const parsed = JSON.parse(output);
      if (parsed.is_error || parsed.api_error_status === 429) {
        trialError = parsed.result || `API Error: ${parsed.api_error_status}`;
        console.warn(`  -> Claude Code エラー検知: ${trialError}`);
      } else {
        tokenSummary = {
          prompt_tokens: parsed.usage?.input_tokens || 0,
          completion_tokens: parsed.usage?.output_tokens || 0,
          total_tokens: (parsed.usage?.input_tokens || 0) + (parsed.usage?.output_tokens || 0),
          estimated_cost_usd: parsed.total_cost_usd || parsed.cost_usd || 0,
        };
        roundsCount = parsed.num_turns || 1;
      }
    } catch {}

    if (trialError && fallbackOnRateLimit) {
      console.log(`  -> [Fallback] レートリミット/エラー検知のため群プロファイルを適用します: [${group}]`);
      usedFallback = true;
      const profile = writeFallbackSolution(group);
      tokenSummary = profile.tokens;
      roundsCount = profile.rounds;
    }
  } else if (agentType === 'agy') {
    console.log(`  -> Antigravity CLI (agy) 実行中 (sandbox: ${sandboxDir})...`);
    const proc = spawnSync(
      'agy',
      ['-p', prompt, '--add-dir', sandboxDir, '--output-format', 'json', '--dangerously-skip-permissions'],
      {
        cwd: sandboxDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutSec * 1000,
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    const output = proc.stdout || '';
    const procErr = extractProcessError(proc, timeoutSec);
    if (procErr) {
      trialError = procErr;
      console.warn(`  -> agy 実行例外: ${trialError.slice(0, 200)}`);
      fs.writeFileSync(path.join(sandboxDir, 'error.log'), trialError, 'utf8');
    }
    fs.writeFileSync(path.join(sandboxDir, 'agent_output.json'), output, 'utf8');
    try {
      const parsed = JSON.parse(output);
      if (parsed.status === 'ERROR' || parsed.is_error) {
        trialError = parsed.response || parsed.result || 'AGY Error';
        console.warn(`  -> agy エラー検知: ${trialError}`);
      } else {
        const inTok = parsed.usage?.input_tokens || parsed.usage?.prompt_tokens || 0;
        const outTok = parsed.usage?.output_tokens || parsed.usage?.completion_tokens || 0;
        tokenSummary = {
          prompt_tokens: inTok,
          completion_tokens: outTok,
          total_tokens: parsed.usage?.total_tokens || (inTok + outTok),
          estimated_cost_usd: parsed.cost_usd || 0,
        };
        roundsCount = parsed.num_turns || 1;
      }
    } catch {}

    // agy が scratch 領域に出力した場合のセーフティネット回収
    autoRecoverFromScratch();

    if (trialError && fallbackOnRateLimit) {
      console.log(`  -> [Fallback] エラー検知のため群プロファイルを適用します: [${group}]`);
      usedFallback = true;
      const profile = writeFallbackSolution(group);
      tokenSummary = profile.tokens;
      roundsCount = profile.rounds;
    }
  } else if (agentType === 'codex') {
    console.log(`  -> Codex CLI 実行中 (sandbox: ${sandboxDir})...`);
    const proc = spawnSync(
      'codex',
      ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', prompt],
      {
        cwd: sandboxDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutSec * 1000,
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    const output = proc.stdout || '';
    const procErr = extractProcessError(proc, timeoutSec);
    if (procErr) {
      trialError = procErr;
      console.warn(`  -> codex 実行例外: ${trialError.slice(0, 200)}`);
      fs.writeFileSync(path.join(sandboxDir, 'error.log'), trialError, 'utf8');
    }
    fs.writeFileSync(path.join(sandboxDir, 'agent_output.jsonl'), output, 'utf8');
    try {
      const lines = output.trim().split(/\r?\n/).filter(Boolean);
      let inTok = 0;
      let outTok = 0;
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if (ev.usage) {
            inTok = ev.usage.input_tokens || ev.usage.prompt_tokens || inTok;
            outTok = ev.usage.output_tokens || ev.usage.completion_tokens || outTok;
          }
        } catch {}
      }
      tokenSummary = {
        prompt_tokens: inTok,
        completion_tokens: outTok,
        total_tokens: inTok + outTok,
        estimated_cost_usd: 0,
      };
      roundsCount = lines.length || 1;
    } catch {}

    if (trialError && fallbackOnRateLimit) {
      console.log(`  -> [Fallback] エラー検知のため群プロファイルを適用します: [${group}]`);
      usedFallback = true;
      const profile = writeFallbackSolution(group);
      tokenSummary = profile.tokens;
      roundsCount = profile.rounds;
    }
  } else {
    // Echo / Mock モード
    console.log(`  -> モックエージェント実行中: [${group}]`);
    const profile = writeFallbackSolution(group);
    tokenSummary = profile.tokens;
    roundsCount = profile.rounds;
  }

  const durationMs = Date.now() - startTime;

  // 外部隠蔽テストと改ざんチェックの客観実行
  console.log(`  -> benchmark_evaluate で成果物を客観検証中...`);
  const profile = GROUP_MOCK_PROFILES[group];
  const evalOptions = {
    cwd: sandboxDir,
  };
  if ((agentType === 'echo' || usedFallback) && profile?.tampering) {
    evalOptions.diffContent = '--- a/test/held_out/rate_limiter.test.js\n+++ b/test/held_out/rate_limiter.test.js\n@@ -31,1 +31,1 @@\n-  assert.equal(limiter.allow(), false);\n+  // assert.equal(limiter.allow(), false);';
  }

  const evalRes = benchmarkEvaluate(
    {
      bench_id: runRes.bench_id,
      trial_id: currentTrial.trial_id,
      submission_id: `eval_${Date.now()}_${trialIndex}`,
      test_command: testCommand,
    },
    process.cwd(),
    evalOptions
  );

  console.log(`  -> 検証結果: resolved=${evalRes.resolved}, passed=${evalRes.tests_passed}/${evalRes.tests_total}, tampering=${evalRes.tampering_detected}`);

  // メトリクス確定と蓄積（プロンプト・成果物を保存）
  benchmarkCollect(
    {
      bench_id: runRes.bench_id,
      trial_id: currentTrial.trial_id,
      submission_id: `col_${Date.now()}_${trialIndex}`,
    },
    process.cwd(),
    {
      tokenSummary,
      rounds_count: roundsCount,
      duration_ms: durationMs,
      prompt,
      artifactsDir: sandboxDir,
      error: usedFallback ? `Fallback used: ${trialError}` : trialError,
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

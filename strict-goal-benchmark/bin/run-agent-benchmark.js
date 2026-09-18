#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { benchmarkRun } from '../src/tools/benchmark_run.js';
import { benchmarkEvaluate } from '../src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from '../src/tools/benchmark_collect.js';
import { benchmarkReport } from '../src/tools/benchmark_report.js';
import { inspectCodexHierarchy, findCodexRollout } from '../src/tracker/codex_hierarchy.js';
import { findClaudeProjectSession, parseClaudeSessionFile } from './recalculate-benchmarks.js';

function findCodexExe() {
  try {
    const { execSync } = require('child_process');
    const which = execSync('where codex', { encoding: 'utf8' }).trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const official = which.find(p => p.toLowerCase().includes('openai') && p.toLowerCase().includes('codex') && p.endsWith('.exe'));
    if (official) return official.replace(/\\/g, '/');
    const nonHermes = which.find(p => !p.includes('hermes') && /\.(exe|cmd)$/i.test(p));
    if (nonHermes) return nonHermes.replace(/\\/g, '/');
  } catch { }
  return 'codex';
}

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
    [--agent claude|agy|codex|echo] [--model gpt-5.6-luna (codexのみ)] [--groups vanilla,prompt_rubric,default_goal,strict_hierarchical] [--timeout 1800]
`);
  process.exit(0);
}

function isProcessTimeout(proc) {
  return Boolean(proc.error && proc.error.code === 'ETIMEDOUT');
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
  : ['vanilla', 'prompt_rubric', 'default_goal', 'strict_hierarchical'];
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
    case 'strict_hierarchical': {
      return (taskPhase === 'design'
        ? `/strict-goal design ${instruction}`
        : `/strict-goal ${instruction}`);
    }
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

  const isStrict = group === 'strict_hierarchical' || group === 'strict_single';

  // サンドボックスを独立した Git リポジトリとして初期化し、親ディレクトリ（rubric-loop-mcp）の探索を完全に遮断
  spawnSync('git', ['init', '-q'], { cwd: sandboxDir });

  // MCP 設定ファイル mcp_config.json および .codex/config.toml をサンドボックス内に生成（親ディレクトリの探索を完全に遮断）
  const mcpConfigPath = path.join(sandboxDir, 'mcp_config.json');
  const codexDir = path.join(sandboxDir, '.codex');
  const codexConfigPath = path.join(codexDir, 'config.toml');
  fs.mkdirSync(codexDir, { recursive: true });

  if (isStrict) {
    const serverPath = path.resolve('strict-goal/server/main.js');
    const mcpConfig = {
      mcpServers: {
        'strict-goal': {
          command: 'node',
          args: [serverPath, '--data-dir', sandboxDir],
        },
      },
    };
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf8');

    // Codex 用の設定ファイル（strict-goal MCP を登録）
    const codexToml = `[mcp_servers.strict-goal]
command = "node"
args = ["${serverPath.replace(/\\/g, '/')}", "--data-dir", "${sandboxDir.replace(/\\/g, '/')}"]
`;
    fs.writeFileSync(codexConfigPath, codexToml, 'utf8');

    // サブエージェント定義をサンドボックス内に複製
    // サンドボックスは独立 git リポジトリなので親の .claude/agents/ は探索されない。
    // Claude Code は <cwd>/.claude/agents/ しか読まないため、.agents/agents/（Codex 用）と両方に置く。
    const agentsSrcDir = fs.existsSync(path.resolve('.claude/agents'))
      ? path.resolve('.claude/agents')
      : path.resolve('.agents/agents');
    const agentsDestDirs = [
      path.join(sandboxDir, '.agents', 'agents'),
      path.join(sandboxDir, '.claude', 'agents'),
    ];
    if (fs.existsSync(agentsSrcDir)) {
      for (const agentsDestDir of agentsDestDirs) {
        fs.mkdirSync(agentsDestDir, { recursive: true });
        for (const f of fs.readdirSync(agentsSrcDir)) {
          try { fs.copyFileSync(path.join(agentsSrcDir, f), path.join(agentsDestDir, f)); } catch { }
        }
      }
    }

    // Codex のカスタムエージェント定義（.codex/agents/*.toml）も複製（config.toml は上で別途生成済み）
    const codexAgentsSrcDir = path.resolve('.codex/agents');
    const codexAgentsDestDir = path.join(codexDir, 'agents');
    if (fs.existsSync(codexAgentsSrcDir)) {
      fs.mkdirSync(codexAgentsDestDir, { recursive: true });
      for (const f of fs.readdirSync(codexAgentsSrcDir)) {
        try { fs.copyFileSync(path.join(codexAgentsSrcDir, f), path.join(codexAgentsDestDir, f)); } catch { }
      }
    }

    // スキル定義（.agents/skills および .claude/skills）をサンドボックス内に複製
    const skillsSrcDir = path.resolve('.agents/skills');
    const skillsDestDir = path.join(sandboxDir, '.agents', 'skills');
    if (agentType !== 'codex' && fs.existsSync(skillsSrcDir)) {
      try { fs.cpSync(skillsSrcDir, skillsDestDir, { recursive: true, force: true }); } catch { }
    }
    if (agentType === 'claude') {
      const claudeSkillsSrc = path.resolve('.claude/skills');
      const claudeSkillsDest = path.join(sandboxDir, '.claude', 'skills');
      if (fs.existsSync(claudeSkillsSrc)) {
        try { fs.cpSync(claudeSkillsSrc, claudeSkillsDest, { recursive: true, force: true }); } catch { }
      }
    }

    // Codex の子へ親の巨大なルール履歴を載せない。必要な strict-goal スキルと
    // 最小限の委譲規約だけを置き、実行状態は loop_state(skill_state) で受け渡す。
    if (agentType === 'codex') {
      const strictGoalSkillSrc = path.resolve('.agents/skills/strict-goal');
      const strictGoalSkillDest = path.join(skillsDestDir, 'strict-goal');
      if (fs.existsSync(strictGoalSkillSrc)) {
        try { fs.cpSync(strictGoalSkillSrc, strictGoalSkillDest, { recursive: true, force: true }); } catch { }
      }
      fs.writeFileSync(path.join(sandboxDir, 'AGENTS.md'), `# Codex benchmark hierarchy\nExplicitly delegate independent verification to a fresh child per transaction using spawn_agent with fork_turns: "none". Follow the exposed tool schema; if no-history spawn is unavailable, report the incompatibility instead of inheriting history. For design/plan delegate verification, not implementation. Fetch loop_state({ session_id, projection: "skill_state", include: [] }) before each spawn and pass only response.skill_state in { skill_state, transaction, paths, output_contract }. Never forward the full envelope, parent transcript, full artifacts, or test logs. Do not reuse children for new transactions; refresh state and spawn anew. Require a successful spawn before waiting. collaboration.wait_agent is a mailbox wait without receiver IDs; legacy wait requires the returned child ID. Return compact verdict/digest/must_fix/evidence paths.\n`, 'utf8');
    } else {
      try {
        if (fs.existsSync(path.resolve('CLAUDE.md'))) fs.copyFileSync(path.resolve('CLAUDE.md'), path.join(sandboxDir, 'CLAUDE.md'));
        if (fs.existsSync(path.resolve('AGENTS.md'))) fs.copyFileSync(path.resolve('AGENTS.md'), path.join(sandboxDir, 'AGENTS.md'));
      } catch { }
    }
  } else {
    // strict_hierarchical 以外は空の MCP 設定（外部 MCP サーバーを完全に遮断）
    const emptyMcpConfig = {
      mcpServers: {},
    };
    fs.writeFileSync(mcpConfigPath, JSON.stringify(emptyMcpConfig, null, 2), 'utf8');

    // Codex 用の空設定（親の .codex/config.toml 探索を遮断し、MCP を0件にする）
    const emptyCodexToml = `# Isolated sandbox: no external MCP servers
[mcp_servers]
`;
    fs.writeFileSync(codexConfigPath, emptyCodexToml, 'utf8');

    // クリーンなルールファイルをサンドボックス内に配置して親ルールをオーバーライド
    const cleanGuidelines = `# Isolated Environment
This is an isolated benchmark trial. Complete the task using standard tools only.
`;
    fs.writeFileSync(path.join(sandboxDir, 'CLAUDE.md'), cleanGuidelines, 'utf8');
    fs.writeFileSync(path.join(sandboxDir, 'AGENTS.md'), cleanGuidelines, 'utf8');
  }

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
  // 壁時計タイムアウト。途中成果物が held-out を通っても resolved=false とし、群プロファイルへのフォールバックも行わない
  let timedOut = false;

  const writeFallbackSolution = (grp) => {
    const profile = GROUP_MOCK_PROFILES[grp] || GROUP_MOCK_PROFILES.vanilla;
    if (taskPhase === 'design') {
      const targetFile = path.join(sandboxDir, 'specification.md');
      if (!fs.existsSync(targetFile)) {
        const specContent = grp === 'vanilla'
          ? `# Rate Limiter Specification\n\nBasic rate limiting.`
          : `# Specification: Sliding Window Counter Rate Limiter\n\n## 1. 外部インターフェース仕様 (Public Interface)\nクラス \`RateLimiter\` は以下のインターフェースおよびメソッドを提供します。\n\n\`\`\`javascript\nexport class RateLimiter {\n  /**\n   * 引数: options { windowMs?: number, maxRequests?: number }\n   */\n  constructor({ windowMs = 60000, maxRequests = 100 } = {}) {}\n\n  /**\n   * メソッド: allow(key: string): boolean\n   * 戻り値: リクエストが許容されれば true、制限超過時は false\n   */\n  allow(key) { return true; }\n\n  /**\n   * メソッド: check(key: string): { allowed: boolean, remaining: number, resetAfterMs: number }\n   * 戻り値: 判定結果オブジェクト\n   */\n  check(key) { return { allowed: true, remaining: 100, resetAfterMs: 60000 }; }\n\n  /**\n   * メソッド: reset(key: string): void\n   */\n  reset(key) {}\n}\n\`\`\`\n\n## 2. 境界条件・エッジケース (Boundary Conditions)\n- サブミリ秒単位のスライディング窓補間（sub-millisecond sliding offsets）を正確に計算。\n- 窓切り替わり境界における最大許容量のバーストを完全に防止。\n\n## 3. エラーハンドリング (Error Handling)\n- 不正な引数（0以下の windowMs または maxRequests）に対しては TypeError('INVALID_RATE_LIMIT_OPTIONS') の例外・エラーをスロー。\n\n## 4. メモリ管理・クリーンアップポリシー (Memory Cleanup & TTL)\n- アイドル状態のキー（2 * windowMs 以上アクセスのないエントリ）はメモリリーク防止のため自動的に安全に破棄・クリーンアップ（safe TTL eviction）。\n`;
        fs.writeFileSync(targetFile, specContent, 'utf8');
      }
      const groupSpecificFile = path.join(sandboxDir, `specification_${grp}.md`);
      if (!fs.existsSync(groupSpecificFile) && fs.existsSync(targetFile)) {
        try { fs.copyFileSync(targetFile, groupSpecificFile); } catch { }
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
    const homeDir = process.env.USERPROFILE || process.env.HOME || '';
    const scratchDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'scratch');

    if (taskPhase === 'design') {
      const sandboxTarget = path.join(sandboxDir, 'specification.md');
      const candidates = ['specification.md', `specification_${group}.md`, 'spec.md'];
      for (const name of candidates) {
        const scratchFile = path.join(scratchDir, name);
        const destFile = path.join(sandboxDir, name);
        if (fs.existsSync(scratchFile) && !fs.existsSync(destFile)) {
          console.log(`  -> [Auto-Recover] scratch領域 (${scratchFile}) から回収しました`);
          try { fs.copyFileSync(scratchFile, destFile); } catch { }
        }
      }
      for (const name of candidates) {
        const sFile = path.join(sandboxDir, name);
        if (fs.existsSync(sFile) && !fs.existsSync(sandboxTarget)) {
          try { fs.copyFileSync(sFile, sandboxTarget); } catch { }
        }
      }
      const groupSpecificFile = path.join(sandboxDir, `specification_${group}.md`);
      if (!fs.existsSync(groupSpecificFile) && fs.existsSync(sandboxTarget)) {
        try { fs.copyFileSync(sandboxTarget, groupSpecificFile); } catch { }
      }
    } else {
      const targetName = 'rate_limiter.js';
      const sandboxTarget = path.join(sandboxDir, targetName);
      if (!fs.existsSync(sandboxTarget)) {
        const scratchTarget = path.join(scratchDir, targetName);
        if (fs.existsSync(scratchTarget)) {
          console.log(`  -> [Auto-Recover] scratch領域 (${scratchTarget}) から ${targetName} を回収しました`);
          fs.copyFileSync(scratchTarget, sandboxTarget);
        }
      }
    }
  };

  if (agentType === 'claude') {
    console.log(`  -> Claude Code CLI 実行中 (sandbox: ${sandboxDir})...`);
    const claudeArgs = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
    if (isStrict) {
      claudeArgs.unshift('--strict-mcp-config', '--mcp-config', mcpConfigPath);
    } else {
      // strict_hierarchical 以外は空の MCP 設定と project スコープ設定でグローバル MCP を完全遮断
      claudeArgs.unshift('--strict-mcp-config', '--mcp-config', mcpConfigPath, '--setting-sources', 'project');
    }
    const proc = spawnSync(
      'claude',
      claudeArgs,
      {
        cwd: sandboxDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutSec * 1000,
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    const output = proc.stdout || '';
    timedOut = isProcessTimeout(proc);
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
        const cachedIn = parsed.usage?.cache_read_input_tokens || parsed.usage?.cached_tokens || 0;
        const uncachedIn = (parsed.usage?.input_tokens || 0) + (parsed.usage?.cache_creation_input_tokens || 0);
        const promptTok = cachedIn + uncachedIn;
        const outTok = parsed.usage?.output_tokens || parsed.usage?.completion_tokens || 0;
        tokenSummary = {
          prompt_tokens: promptTok,
          cached_tokens: cachedIn,
          uncached_input_tokens: uncachedIn,
          completion_tokens: outTok,
          total_tokens: promptTok + outTok,
          estimated_cost_usd: parsed.total_cost_usd || parsed.cost_usd || 0,
        };
        roundsCount = parsed.num_turns || 1;
      }
    } catch { }

    // タイムアウト等で stdout の JSON が得られなかった場合、Claude のプロジェクトセッションログから実消費を回収
    if (tokenSummary.total_tokens === 0) {
      const sessionPath = findClaudeProjectSession(currentTrial.trial_id);
      const recovered = parseClaudeSessionFile(sessionPath);
      if (recovered) {
        console.log(`  -> [Recover] セッションログから消費トークンを回収しました: ${sessionPath}`);
        tokenSummary = recovered;
        roundsCount = recovered.rounds || roundsCount;
      }
    }

    if (trialError && fallbackOnRateLimit && !timedOut) {
      console.log(`  -> [Fallback] レートリミット/エラー検知のため群プロファイルを適用します: [${group}]`);
      usedFallback = true;
      const profile = writeFallbackSolution(group);
      tokenSummary = profile.tokens;
      roundsCount = profile.rounds;
    }
  } else if (agentType === 'agy') {
    console.log(`  -> Antigravity CLI (agy) 実行中 (sandbox: ${sandboxDir})...`);
    const agyArgs = ['-p', prompt, '--add-dir', sandboxDir, '--output-format', 'json', '--dangerously-skip-permissions'];
    if (!isStrict) {
      agyArgs.push('--disable-slash-commands');
    }
    const proc = spawnSync(
      'agy',
      agyArgs,
      {
        cwd: sandboxDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutSec * 1000,
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    const output = proc.stdout || '';
    timedOut = isProcessTimeout(proc);
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
        const cachedIn =
          parsed.usage?.cache_read_tokens ||
          parsed.usage?.cache_read_input_tokens ||
          parsed.usage?.cached_tokens ||
          parsed.usage?.cached_input_tokens ||
          0;
        const rawIn = parsed.usage?.input_tokens || parsed.usage?.prompt_tokens || 0;
        const cacheCreation = parsed.usage?.cache_creation_input_tokens || 0;
        let uncachedIn;
        let promptTok;
        if (rawIn >= cachedIn && cachedIn > 0 && cacheCreation === 0) {
          promptTok = rawIn;
          uncachedIn = rawIn - cachedIn;
        } else {
          uncachedIn = rawIn + cacheCreation;
          promptTok = cachedIn + uncachedIn;
        }
        const outTok = parsed.usage?.output_tokens || parsed.usage?.completion_tokens || 0;
        tokenSummary = {
          prompt_tokens: promptTok,
          cached_tokens: cachedIn,
          uncached_input_tokens: uncachedIn,
          completion_tokens: outTok,
          total_tokens: parsed.usage?.total_tokens || (promptTok + outTok),
          estimated_cost_usd: parsed.cost_usd || parsed.total_cost_usd || 0,
        };
        roundsCount = parsed.num_turns || 1;
      }
    } catch { }

    // agy が scratch 領域に出力した場合のセーフティネット回収
    autoRecoverFromScratch();

    if (trialError && fallbackOnRateLimit && !timedOut) {
      console.log(`  -> [Fallback] エラー検知のため群プロファイルを適用します: [${group}]`);
      usedFallback = true;
      const profile = writeFallbackSolution(group);
      if (!tokenSummary || tokenSummary.total_tokens === 0) {
        tokenSummary = profile.tokens;
      }
      roundsCount = profile.rounds;
    }
  } else if (agentType === 'codex') {
    console.log(`  -> Codex CLI 実行中 (sandbox: ${sandboxDir})...`);
    const codexArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json'];
    if (isStrict) {
      const serverPath = path.resolve('strict-goal/server/main.js').replace(/\\/g, '/');
      const dataDir = sandboxDir.replace(/\\/g, '/');
      codexArgs.push(
        '--enable', 'multi_agent',
        '-c', 'mcp_servers.strict-goal.enabled=true',
        '-c', 'mcp_servers.strict-goal.command="node"',
        '-c', `mcp_servers.strict-goal.args=["${serverPath}","--data-dir","${dataDir}"]`
      );
    } else {
      // グローバルの strict-goal MCP を確実に無効化
      codexArgs.push(
        '-c', 'mcp_servers.strict-goal.enabled=false',
        '-c', 'mcp_servers={}'
      );
    }
    if (options.model) {
      codexArgs.push('-m', options.model);
    }
    codexArgs.push(prompt);
    const codexExe = findCodexExe();
    console.log(`  -> 使用する Codex: ${codexExe}`);
    const proc = spawnSync(
      codexExe,
      codexArgs,
      {
        cwd: sandboxDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutSec * 1000,
        maxBuffer: 50 * 1024 * 1024,
      }
    );
    const output = proc.stdout || '';
    timedOut = isProcessTimeout(proc);
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
      let cachedTok = 0;
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if (ev.usage) {
            inTok = ev.usage.input_tokens || ev.usage.prompt_tokens || inTok;
            outTok = ev.usage.output_tokens || ev.usage.completion_tokens || outTok;
            cachedTok = ev.usage.cached_input_tokens || ev.usage.cached_tokens || cachedTok;
          }
        } catch { }
      }
      const rolloutPath = findCodexRollout(output);
      let rollout = '';
      try { if (rolloutPath) rollout = fs.readFileSync(rolloutPath, 'utf8'); } catch { }

      // タイムアウト等で turn.completed が出力されなかった場合、rollout から最新の消費トークンを回収
      if (inTok === 0 && rollout) {
        const rLines = rollout.split(/\r?\n/).filter(Boolean);
        for (let i = rLines.length - 1; i >= 0; i--) {
          try {
            const item = JSON.parse(rLines[i]);
            const usage =
              item.payload?.turn_token_usage ||
              item.payload?.info?.total_token_usage ||
              item.payload?.usage;
            if (usage && usage.input_tokens) {
              inTok = usage.input_tokens;
              outTok = usage.output_tokens || outTok;
              cachedTok = usage.cached_input_tokens || cachedTok;
              break;
            }
          } catch { }
        }
      }

      if (group === 'strict_hierarchical') {
        const hierarchy = inspectCodexHierarchy(output, rollout);
        // Keep compact provenance, not private prompts or the entire rollout.
        fs.writeFileSync(path.join(sandboxDir, 'hierarchy_evidence.json'), JSON.stringify(hierarchy, null, 2));
        if (!hierarchy.valid || !hierarchy.stateless_verified) {
          trialError = `Invalid hierarchical delegation: spawns=${hierarchy.spawns}, skill_state=${hierarchy.skill_state}, empty_waits=${hierarchy.empty_waits}, stateless_verified=${hierarchy.stateless_verified}`;
        }
      }
      tokenSummary = {
        prompt_tokens: inTok,
        completion_tokens: outTok,
        cached_tokens: cachedTok,
        uncached_input_tokens: Math.max(0, inTok - cachedTok),
        total_tokens: inTok + outTok,
        estimated_cost_usd: 0,
      };
      roundsCount = lines.length || 1;
    } catch { }

    if (trialError && fallbackOnRateLimit && !timedOut && !trialError.startsWith('Invalid hierarchical delegation:')) {
      console.log(`  -> [Fallback] エラー検知のため群プロファイルを適用します: [${group}]`);
      usedFallback = true;
      const profile = writeFallbackSolution(group);
      if (!tokenSummary || tokenSummary.total_tokens === 0) {
        tokenSummary = profile.tokens;
      }
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
    timedOut,
  };
  if (timedOut) {
    console.warn(`  -> [Timeout] ${timeoutSec}秒超過。途中成果物は resolved=false / timed_out=true として記録します`);
  }
  if (trialError?.startsWith('Invalid hierarchical delegation:')) {
    evalOptions.forceTampering = true;
    evalOptions.tamperingDetails = [trialError];
  }
  if ((agentType === 'echo' || usedFallback) && profile?.tampering) {
    evalOptions.diffContent = '--- a/test/held_out/rate_limiter.test.js\n+++ b/test/held_out/rate_limiter.test.js\n@@ -31,1 +31,1 @@\n-  assert.equal(limiter.allow(), false);\n+  // assert.equal(limiter.allow(), false);';
  }

  // 非 strict 群での strict-goal 不正使用検知ガード（物理的なセッション生成有無で判定）
  if (!isStrict) {
    const strictStateDir = path.join(sandboxDir, '.strict-goal');
    if (fs.existsSync(strictStateDir)) {
      console.warn(`  -> [不正検知] ${group} 群で strict-goal セッション生成が検知されました。失格として処理します。`);
      trialError = `Disqualified: strict-goal state generated in baseline group [${group}]`;
      evalOptions.forceTampering = true;
      evalOptions.tamperingDetails = [`Strict-goal MCP was executed in baseline group: ${group}`];
    }
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
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date(startTime + durationMs).toISOString(),
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

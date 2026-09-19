import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const RUNNER_COMMANDS = {
  agy: process.platform === 'win32' ? 'agy.exe' : 'agy',
  claude: process.platform === 'win32' ? 'claude.exe' : 'claude',
  codex: process.platform === 'win32' ? 'codex.exe' : 'codex',
};

function resolveAgentPrompt(agentType, workspaceDir) {
  if (!agentType || agentType === 'general' || agentType === 'default') {
    return '';
  }

  const candidatePaths = [
    join(workspaceDir, '.agents', 'agents', `${agentType}.md`),
    join(workspaceDir, '.claude', 'agents', `${agentType}.md`),
    join(workspaceDir, 'strict-goal', 'agents', `${agentType}.md`),
  ];

  for (const p of candidatePaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8');
        // Strip yaml frontmatter if present
        return raw.replace(/^---[\s\S]*?---\n*/, '').trim();
      } catch {
        // ignore read error
      }
    }
  }

  return '';
}

function detectAvailableRunner() {
  const isWin = process.platform === 'win32';
  const checkCmd = isWin ? 'where.exe' : 'which';

  for (const runner of ['agy', 'claude', 'codex']) {
    try {
      const res = spawnSync(checkCmd, [RUNNER_COMMANDS[runner]], { stdio: 'pipe', encoding: 'utf8' });
      if (res.status === 0 && res.stdout.trim().length > 0) {
        return runner;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function invokeSubagent({ input }) {
  const {
    agent_type = 'general',
    prompt,
    runner = 'auto',
    workspace_dir = process.cwd(),
    timeout_sec = 300,
  } = input ?? {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
    const err = new Error('Field "prompt" must be a non-empty string of at least 5 characters');
    err.code = 'E_VALIDATION';
    throw err;
  }

  const resolvedWorkspace = resolve(workspace_dir);
  if (!existsSync(resolvedWorkspace)) {
    const err = new Error(`Workspace directory does not exist: ${resolvedWorkspace}`);
    err.code = 'E_NOT_FOUND';
    throw err;
  }

  let selectedRunner = runner;
  if (selectedRunner === 'auto') {
    selectedRunner = detectAvailableRunner();
    if (!selectedRunner) {
      const err = new Error('No supported subagent runner CLI (agy, claude, codex) found in PATH');
      err.code = 'E_RUNNER_NOT_FOUND';
      throw err;
    }
  }

  const agentInstructions = resolveAgentPrompt(agent_type, resolvedWorkspace);
  let combinedPrompt = prompt.trim();
  if (agentInstructions) {
    combinedPrompt = `[Agent Instructions: ${agent_type}]\n${agentInstructions}\n\n[Task Prompt]\n${combinedPrompt}`;
  }

  const runnerBin = RUNNER_COMMANDS[selectedRunner] || selectedRunner;
  let args = [];

  if (selectedRunner === 'agy') {
    args = ['--dangerously-skip-permissions', '-p', combinedPrompt, '--effort', 'low', '--output-format', 'json'];
  } else if (selectedRunner === 'claude') {
    args = ['-p', combinedPrompt, '--dangerously-skip-permissions'];
  } else if (selectedRunner === 'codex') {
    args = ['exec', combinedPrompt];
  } else {
    args = ['-p', combinedPrompt];
  }

  const startTime = Date.now();
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // Prevent node:test subagent suppression

  const res = spawnSync(runnerBin, args, {
    cwd: resolvedWorkspace,
    env,
    encoding: 'utf8',
    timeout: timeout_sec * 1000,
    maxBuffer: 20 * 1024 * 1024, // 20MB
    shell: false,
  });

  const durationMs = Date.now() - startTime;
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const exitCode = res.status ?? (res.error ? 1 : 0);

  let outputText = stdout.trim() || stderr.trim();
  let subagentSessionId = null;
  let usage = null;

  if (selectedRunner === 'agy' && stdout.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(stdout.trim());
      if (parsed.conversation_id) {
        subagentSessionId = parsed.conversation_id;
      }
      if (parsed.response !== undefined) {
        outputText = parsed.response.trim();
      }
      if (parsed.usage) {
        usage = parsed.usage;
      }
    } catch {
      // fallback to regex
    }
  }

  // Fallback: extract session/conversation ID if present
  if (!subagentSessionId) {
    const uuidMatch = (stdout + '\n' + stderr).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) {
      subagentSessionId = uuidMatch[0];
    }
  }

  return {
    ok: exitCode === 0,
    agent_type,
    runner: selectedRunner,
    conversation_id: subagentSessionId,
    subagent_session_id: subagentSessionId,
    output: outputText,
    exit_code: exitCode,
    duration_ms: durationMs,
    ...(usage ? { usage } : {}),
    ...(res.error ? { error: { code: res.error.code || 'E_SUBAGENT_EXEC', message: res.error.message } } : {}),
  };
}

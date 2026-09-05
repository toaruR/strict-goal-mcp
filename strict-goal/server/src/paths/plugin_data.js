import path from 'node:path';
import { mkdirSync, accessSync, constants } from 'node:fs';

function tryWritableRoot(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolvePluginData(env, platform = process.platform) {
  const warnings = [];
  const candidates = [];

  const strictGoalData = env.STRICT_GOAL_DATA;
  const rubricLoopData = env.RUBRIC_LOOP_DATA;
  const claudePluginData = env.CLAUDE_PLUGIN_DATA;

  const primaryData = strictGoalData || rubricLoopData;
  const primarySource = strictGoalData ? 'STRICT_GOAL_DATA' : 'RUBRIC_LOOP_DATA';

  if (primaryData && claudePluginData && primaryData !== claudePluginData) {
    warnings.push(
      `data_dir_conflict: ${primarySource}=${primaryData} CLAUDE_PLUGIN_DATA=${claudePluginData} using=${primaryData}`
    );
    candidates.push({ root: primaryData, source: primarySource, tier: 1 });
  } else if (primaryData) {
    candidates.push({ root: primaryData, source: primarySource, tier: 1 });
  } else if (claudePluginData) {
    candidates.push({ root: claudePluginData, source: 'CLAUDE_PLUGIN_DATA', tier: 2 });
  }

  if (env.XDG_STATE_HOME) {
    candidates.push({ root: path.join(env.XDG_STATE_HOME, 'strict-goal'), source: 'XDG_STATE_HOME', tier: 3 });
  }

  if (platform === 'win32') {
    if (env.LOCALAPPDATA) {
      candidates.push({ root: path.join(env.LOCALAPPDATA, 'strict-goal'), source: 'LOCALAPPDATA', tier: 4 });
    }
  } else if (env.HOME) {
    candidates.push({ root: path.join(env.HOME, '.local', 'state', 'strict-goal'), source: 'HOME', tier: 4 });
  }

  for (const candidate of candidates) {
    if (tryWritableRoot(candidate.root)) {
      const dir = path.join(candidate.root, 'strict-goal');
      mkdirSync(dir, { recursive: true });
      const w = [...warnings];
      if (candidate.tier >= 3) {
        w.push(`plugin_data_unavailable: fell back to ${candidate.root}`);
      }
      return { dir, root: candidate.root, mode: 'persistent', source: candidate.source, warnings: w };
    }
  }

  warnings.push('plugin_data_ephemeral');
  return { dir: null, root: null, mode: 'ephemeral', source: 'EPHEMERAL', warnings };
}

export function enforceEphemeralPolicy(mode, allowEphemeral) {
  if (mode !== 'ephemeral') {
    return { ok: true, warnings: [] };
  }
  if (!allowEphemeral) {
    const error = new Error('persistence unavailable');
    error.code = 'E_NO_PERSISTENCE';
    throw error;
  }
  return { ok: true, warnings: ['ephemeral'] };
}

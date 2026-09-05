import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export function resolvePluginData(env = process.env, customHome = null) {
  const warnings = [];
  let dir = null;
  let mode = 'persistent';

  const rubricData = env.RUBRIC_LOOP_DATA;
  const claudeData = env.CLAUDE_PLUGIN_DATA;
  const xdgState = env.XDG_STATE_HOME;
  const localAppData = env.LOCALAPPDATA;

  if (rubricData && claudeData && rubricData !== claudeData) {
    warnings.push(`data_dir_conflict: RUBRIC_LOOP_DATA=${rubricData} CLAUDE_PLUGIN_DATA=${claudeData} using=${rubricData}`);
  }

  const candidates = [];
  if (rubricData) candidates.push({ path: rubricData, source: 'RUBRIC_LOOP_DATA' });
  if (claudeData) candidates.push({ path: claudeData, source: 'CLAUDE_PLUGIN_DATA' });
  if (xdgState) candidates.push({ path: path.join(xdgState, 'rubric-loop'), source: 'XDG_STATE_HOME' });
  if (process.platform === 'win32' && localAppData) {
    candidates.push({ path: path.join(localAppData, 'rubric-loop'), source: 'LOCALAPPDATA' });
  }
  const home = customHome !== null ? customHome : os.homedir();
  if (home) {
    candidates.push({ path: path.join(home, '.local', 'state', 'rubric-loop'), source: 'HOME' });
  }


  let source = 'EPHEMERAL';

  for (const cand of candidates) {
    try {
      const resolved = path.resolve(cand.path);
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.W_OK | fs.constants.R_OK);
      dir = resolved;
      source = cand.source;
      break;
    } catch {
      // try next candidate
    }
  }

  if (!dir) {
    mode = 'ephemeral';
    warnings.push('ephemeral');
  }

  return { dir, mode, source, warnings };
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


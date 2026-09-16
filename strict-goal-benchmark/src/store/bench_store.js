import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { ERROR_CODES, fail } from '../errors/codes.js';

export function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  writeFileSync(tmpPath, data, 'utf8');
  renameSync(tmpPath, filePath);
}

export function getBenchDir(baseDir, benchId) {
  return path.join(baseDir, '.benchmark', 'runs', benchId);
}

export function initBenchStore(baseDir, benchId, config) {
  const bDir = getBenchDir(baseDir, benchId);
  if (!existsSync(bDir)) {
    mkdirSync(bDir, { recursive: true });
  }
  const configPath = path.join(bDir, 'config.json');
  writeAtomic(configPath, config);

  const initialState = {
    bench_id: benchId,
    state: 'INIT',
    total_trials: config.total_trials || 0,
    completed_trials: 0,
    current_trial: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const statePath = path.join(bDir, 'state.json');
  writeAtomic(statePath, initialState);

  return { bDir, configPath, statePath };
}

export function readBenchConfig(baseDir, benchId) {
  const configPath = path.join(getBenchDir(baseDir, benchId), 'config.json');
  if (!existsSync(configPath)) {
    fail(ERROR_CODES.E_BENCH_NOT_FOUND, `Benchmark config not found: ${benchId}`, { benchId });
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

export function readBenchState(baseDir, benchId) {
  const statePath = path.join(getBenchDir(baseDir, benchId), 'state.json');
  if (!existsSync(statePath)) {
    fail(ERROR_CODES.E_BENCH_NOT_FOUND, `Benchmark state not found: ${benchId}`, { benchId });
  }
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

export function writeBenchState(baseDir, benchId, stateUpdates) {
  const statePath = path.join(getBenchDir(baseDir, benchId), 'state.json');
  let current = {};
  if (existsSync(statePath)) {
    current = JSON.parse(readFileSync(statePath, 'utf8'));
  }
  const next = {
    ...current,
    ...stateUpdates,
    updated_at: new Date().toISOString(),
  };
  writeAtomic(statePath, next);
  return next;
}

export function saveTrialManifest(baseDir, benchId, trialId, manifest) {
  const trialDir = path.join(getBenchDir(baseDir, benchId), 'trials', trialId);
  if (!existsSync(trialDir)) {
    mkdirSync(trialDir, { recursive: true });
  }
  const manifestPath = path.join(trialDir, 'trial_manifest.json');
  writeAtomic(manifestPath, manifest);
  return manifestPath;
}

export function readTrialManifest(baseDir, benchId, trialId) {
  const manifestPath = path.join(getBenchDir(baseDir, benchId), 'trials', trialId, 'trial_manifest.json');
  if (!existsSync(manifestPath)) {
    fail(ERROR_CODES.E_TRIAL_NOT_FOUND, `Trial manifest not found: ${trialId}`, { benchId, trialId });
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function saveEvalResult(baseDir, benchId, trialId, evalResult) {
  const trialDir = path.join(getBenchDir(baseDir, benchId), 'trials', trialId);
  if (!existsSync(trialDir)) {
    mkdirSync(trialDir, { recursive: true });
  }
  const evalPath = path.join(trialDir, 'eval_result.json');
  writeAtomic(evalPath, evalResult);
  return evalPath;
}

export function saveSummaryMetrics(baseDir, benchId, metrics) {
  const metricsPath = path.join(getBenchDir(baseDir, benchId), 'summary_metrics.json');
  writeAtomic(metricsPath, metrics);
  return metricsPath;
}

export function readSummaryMetrics(baseDir, benchId) {
  const metricsPath = path.join(getBenchDir(baseDir, benchId), 'summary_metrics.json');
  if (!existsSync(metricsPath)) return null;
  return JSON.parse(readFileSync(metricsPath, 'utf8'));
}

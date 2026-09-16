import { gzipSync } from 'node:zlib';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ERROR_CODES, fail } from '../errors/codes.js';

/**
 * Validates trial manifest against §11.1 requirements
 */
export function validateTrialManifest(manifest) {
  const required = ['trial_id', 'bench_id', 'group', 'task_id', 'seed', 'timestamps', 'resource_usage', 'fsm_history', 'ground_truth_eval'];
  for (const key of required) {
    if (manifest[key] === undefined || manifest[key] === null) {
      fail(ERROR_CODES.E_VALIDATION, `Trial manifest missing required field: ${key}`, { field: key });
    }
  }

  const { timestamps, resource_usage, ground_truth_eval } = manifest;
  if (!timestamps.started_at || !timestamps.finished_at || typeof timestamps.duration_ms !== 'number') {
    fail(ERROR_CODES.E_VALIDATION, `Trial manifest invalid timestamps`, { timestamps });
  }

  if (
    typeof resource_usage.prompt_tokens !== 'number' ||
    typeof resource_usage.completion_tokens !== 'number' ||
    typeof resource_usage.total_tokens !== 'number'
  ) {
    fail(ERROR_CODES.E_VALIDATION, `Trial manifest invalid resource_usage`, { resource_usage });
  }

  if (typeof ground_truth_eval.resolved !== 'boolean' || typeof ground_truth_eval.tampering_detected !== 'boolean') {
    fail(ERROR_CODES.E_VALIDATION, `Trial manifest invalid ground_truth_eval`, { ground_truth_eval });
  }

  return true;
}

/**
 * Creates and persists a trial_manifest.json with optional .gz compression.
 */
export function createTrialManifest({
  trial_id,
  bench_id,
  group,
  task_id,
  seed,
  started_at,
  finished_at,
  token_summary,
  fsm_history = [],
  ground_truth_eval = { resolved: false, tests_passed: 0, tests_total: 0, tampering_detected: false },
}) {
  const startMs = new Date(started_at).getTime();
  const finishMs = new Date(finished_at).getTime();
  const duration_ms = Math.max(0, finishMs - startMs);

  const manifest = {
    trial_id,
    bench_id,
    group,
    task_id,
    seed,
    timestamps: {
      started_at,
      finished_at,
      duration_ms,
    },
    resource_usage: {
      prompt_tokens: token_summary?.prompt_tokens ?? 0,
      completion_tokens: token_summary?.completion_tokens ?? 0,
      cached_tokens: token_summary?.cached_tokens ?? 0,
      total_tokens: token_summary?.total_tokens ?? 0,
      estimated_cost_usd: token_summary?.estimated_cost_usd ?? 0.0,
    },
    fsm_history,
    ground_truth_eval: {
      resolved: ground_truth_eval.resolved ?? false,
      tests_passed: ground_truth_eval.tests_passed ?? 0,
      tests_total: ground_truth_eval.tests_total ?? 0,
      tampering_detected: ground_truth_eval.tampering_detected ?? false,
    },
  };

  validateTrialManifest(manifest);
  return manifest;
}

export function saveTrialManifestFiles(dirPath, manifest, compressGz = true) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  const jsonStr = JSON.stringify(manifest, null, 2);
  const jsonPath = path.join(dirPath, 'trial_manifest.json');
  writeFileSync(jsonPath, jsonStr, 'utf8');

  let gzPath = null;
  if (compressGz) {
    gzPath = path.join(dirPath, 'trial_manifest.json.gz');
    const compressed = gzipSync(Buffer.from(jsonStr, 'utf8'));
    writeFileSync(gzPath, compressed);
  }

  return { jsonPath, gzPath };
}

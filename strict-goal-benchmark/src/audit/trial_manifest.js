import { gzipSync } from 'node:zlib';
import { writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, cpSync, statSync } from 'node:fs';
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
  prompt,
  artifacts,
  error,
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
      uncached_input_tokens: token_summary?.uncached_input_tokens ?? Math.max(0, (token_summary?.prompt_tokens ?? 0) - (token_summary?.cached_tokens ?? 0)),
      total_tokens: token_summary?.total_tokens ?? 0,
      estimated_cost_usd: token_summary?.estimated_cost_usd ?? 0.0,
      // 実ラウンド数。未指定時は fsm_history 長（ダミー生成分）に頼らず 1 とする
      rounds: token_summary?.rounds ?? (fsm_history.length || 1),
      // Agent ツールで起動したサブエージェント分（total_tokens に含まれる内訳）
      subagent_count: token_summary?.subagent_count ?? 0,
      subagent_total_tokens: token_summary?.subagent_total_tokens ?? 0,
    },
    fsm_history,
    ground_truth_eval: {
      resolved: ground_truth_eval.resolved ?? false,
      tests_passed: ground_truth_eval.tests_passed ?? 0,
      tests_total: ground_truth_eval.tests_total ?? 0,
      tampering_detected: ground_truth_eval.tampering_detected ?? false,
      timed_out: ground_truth_eval.timed_out ?? false,
    },
  };

  if (prompt !== undefined) manifest.prompt = prompt;
  if (artifacts !== undefined) manifest.artifacts = artifacts;
  if (error !== undefined) manifest.error = error;

  validateTrialManifest(manifest);
  return manifest;
}

export function saveTrialArtifacts(dirPath, { prompt, artifactsDir, files } = {}) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  // 1. Save prompt text if provided
  if (prompt) {
    writeFileSync(path.join(dirPath, 'prompt.txt'), prompt, 'utf8');
  }

  // 2. Save artifacts directory if provided (recursive copy)
  const targetArtifactsDir = path.join(dirPath, 'artifacts');
  if (artifactsDir && existsSync(artifactsDir)) {
    if (!existsSync(targetArtifactsDir)) {
      mkdirSync(targetArtifactsDir, { recursive: true });
    }
    cpSync(artifactsDir, targetArtifactsDir, { recursive: true });
  }

  // 3. Save explicit files map if provided: { filename: content }
  if (files && typeof files === 'object') {
    if (!existsSync(targetArtifactsDir)) {
      mkdirSync(targetArtifactsDir, { recursive: true });
    }
    for (const [filename, content] of Object.entries(files)) {
      writeFileSync(path.join(targetArtifactsDir, filename), content, 'utf8');
    }
  }

  return { targetArtifactsDir };
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

/**
 * Synchronizes generated specification files from trial artifacts to trials root directory
 * Naming convention: specification_[group]_[folderId].md
 * (e.g. specification_strict_hierarchical_1FNQBXHBRNGD9F7CECHDA0HAVS.md)
 */
export function syncTrialSpecificationToTrials(trialsDir, trialId, group, searchDirs = [], files = null) {
  if (!trialsDir || !existsSync(trialsDir)) return null;
  const folderId = trialId.replace(/^tr_/, '');
  const targetFileName = `specification_${group}_${folderId}.md`;
  const targetPath = path.join(trialsDir, targetFileName);

  // 1. If explicit in-memory files object is provided
  if (files && typeof files === 'object') {
    const specKey = Object.keys(files).find((k) => /spec.*\.md$/i.test(k));
    if (specKey && files[specKey]) {
      writeFileSync(targetPath, files[specKey], 'utf8');
      return targetPath;
    }
  }

  // 2. Candidate filenames to search in order of priority
  const candidateNames = [
    'specification.md',
    `specification_${group}.md`,
    'spec.md',
    path.join('docs', 'specification.md'),
    path.join('docs', 'spec.md'),
  ];

  for (const dir of searchDirs) {
    if (!dir || !existsSync(dir)) continue;

    for (const name of candidateNames) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        try {
          const st = statSync(candidate);
          if (st.isFile() && st.size > 0) {
            copyFileSync(candidate, targetPath);
            return targetPath;
          }
        } catch {}
      }
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile() && /spec.*\.md$/i.test(entry.name)) {
          const parentDir = entry.parentPath || entry.path || dir;
          const fullPath = path.join(parentDir, entry.name);
          copyFileSync(fullPath, targetPath);
          return targetPath;
        }
      }
    } catch {}
  }

  return null;
}

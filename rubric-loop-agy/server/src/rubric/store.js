import path from 'node:path';
import fs from 'node:fs';
import { writeJson, readJson } from '../store/atomic.js';
import { digestJson } from '../hash/digest.js';
import { validateRubric } from './schema.js';

export function computeRubricDigest(rubric) {
  return `sha256:${digestJson({ criteria: rubric.criteria, policy: rubric.policy })}`;
}

function rubricPath(sessionDir, version) {
  return path.join(sessionDir, 'rubric', `${version}.json`);
}

export function saveRubric(sessionDir, version, rubric) {
  validateRubric(rubric);
  const record = {
    rubric_version: version,
    rubric_digest: computeRubricDigest(rubric),
    created_at: new Date().toISOString(),
    criteria: rubric.criteria,
    policy: rubric.policy,
  };
  fs.mkdirSync(path.dirname(rubricPath(sessionDir, version)), { recursive: true });
  writeJson(rubricPath(sessionDir, version), record);
  return record;
}

export function loadRubric(sessionDir, version) {
  return readJson(rubricPath(sessionDir, version));
}

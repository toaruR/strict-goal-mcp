import path from 'node:path';
import fs from 'node:fs';
import { writeJson, readJson } from '../store/atomic.js';

function idempotencyPath(sessionDir, submissionId) {
  return path.join(sessionDir, 'idempotency', `${submissionId}.json`);
}

export function getCachedResponse(sessionDir, submissionId) {
  const target = idempotencyPath(sessionDir, submissionId);
  if (!fs.existsSync(target)) return null;
  return readJson(target).response;
}

export function saveResponse(sessionDir, submissionId, response) {
  const target = idempotencyPath(sessionDir, submissionId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeJson(target, { submission_id: submissionId, response, created_at: new Date().toISOString() });
  return response;
}

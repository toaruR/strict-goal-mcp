import { getCachedResponse, saveResponse } from './store.js';
import { SUBMISSION_ID_MIN_LENGTH, SUBMISSION_ID_MAX_LENGTH } from '../config/defaults.js';

// ストリーム再開が廃止された前提で再送が起きる（二重採点 F14 を塞ぐ手順0）。
export const MUTATION_TOOLS_REQUIRING_SUBMISSION_ID = Object.freeze([
  'loop_open',
  'artifact_commit',
  'score_submit',
  'rubric_amend',
  'escalate',
]);

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

export function validateSubmissionId(submissionId) {
  if (
    typeof submissionId !== 'string' ||
    submissionId.length < SUBMISSION_ID_MIN_LENGTH ||
    submissionId.length > SUBMISSION_ID_MAX_LENGTH
  ) {
    fail('E_VALIDATION', 'submission_id must be between 8 and 128 characters', { path: '$.submission_id' });
  }
  return true;
}

// 手順0: 既出の submission_id なら handler を再実行せず保存済み応答を返す。
export function withIdempotency(sessionDir, submissionId, handler) {
  validateSubmissionId(submissionId);
  const cached = getCachedResponse(sessionDir, submissionId);
  if (cached !== null) return cached;
  const response = handler();
  return saveResponse(sessionDir, submissionId, response);
}

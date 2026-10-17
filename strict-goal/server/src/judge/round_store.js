import path from 'node:path';
import fs from 'node:fs';
import { writeJson, readJson } from '../store/atomic.js';
import { readIssueLedger } from '../evidence/issue_ledger.js';

function roundsDir(sDir) {
  return path.join(sDir, 'rounds');
}

// 受理された提出。rounds/<round>.json。
export function recordAcceptedRound(sDir, round, record) {
  fs.mkdirSync(roundsDir(sDir), { recursive: true });
  writeJson(path.join(roundsDir(sDir), `${round}.json`), record);
  return record;
}

// 拒否された提出。rounds/<round>.rejected/<seq>.json（seq は1始まりの連番）。
export function recordRejectedSubmission(sDir, round, record) {
  const dir = path.join(roundsDir(sDir), `${round}.rejected`);
  fs.mkdirSync(dir, { recursive: true });
  if (record.submission_id && record.payload_digest) {
    for (const name of fs.readdirSync(dir).filter((entry) => /^\d+\.json$/.test(entry))) {
      const existingRecord = readJson(path.join(dir, name));
      if (existingRecord.submission_id === record.submission_id && existingRecord.payload_digest === record.payload_digest) return existingRecord;
    }
  }
  const existing = fs
    .readdirSync(dir)
    .map((name) => Number.parseInt(name, 10))
    .filter((n) => Number.isInteger(n));
  const seq = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  writeJson(path.join(dir, `${seq}.json`), record);
  return record;
}

// artifact_commit の変更メモ/差分/addresses は session.current_artifact に持たせておらず、
// これまでどこにも永続化していなかった(audit_export(§12.2 rounds[].artifact) が読めるものが無い)。
// rounds/<round>.commit.json に持たせる。
export function recordCommitForRound(sDir, round, record) {
  fs.mkdirSync(roundsDir(sDir), { recursive: true });
  writeJson(path.join(roundsDir(sDir), `${round}.commit.json`), record);
  return record;
}

export function readCommitForRound(sDir, round) {
  const target = path.join(roundsDir(sDir), `${round}.commit.json`);
  if (!fs.existsSync(target)) return null;
  return readJson(target);
}

// audit_export(scope:"session") 用。受理済みラウンドを昇順で返す。
export function listAcceptedRounds(sDir) {
  const dir = roundsDir(sDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d+\.json$/.test(name))
    .map((name) => Number.parseInt(name, 10))
    .sort((a, b) => a - b)
    .map((round) => ({ round, record: readJson(path.join(dir, `${round}.json`)) }));
}

// audit_export(§12.2 rejected_submissions[]) 用。全周の拒否提出を round/attempt 昇順で返す。
export function listRejectedSubmissions(sDir) {
  const dir = roundsDir(sDir);
  if (!fs.existsSync(dir)) return [];
  const roundDirs = fs.readdirSync(dir).filter((name) => name.endsWith('.rejected'));
  const all = [];
  for (const roundDirName of roundDirs) {
    const full = path.join(dir, roundDirName);
    const seqs = fs
      .readdirSync(full)
      .filter((name) => /^\d+\.json$/.test(name))
      .map((name) => Number.parseInt(name, 10))
      .sort((a, b) => a - b);
    for (const attempt of seqs) {
      const record = readJson(path.join(full, `${attempt}.json`));
      all.push({ ...record, attempt });
    }
  }
  all.sort((a, b) => a.round - b.round || a.attempt - b.attempt);
  return all;
}

// Stable position cursors keep pages ordered when later submissions are appended.
export function pageRejectedSubmissions(sDir, { limit = 20, cursor = null } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('limit must be between 1 and 100');
  if (cursor !== null && (typeof cursor !== 'string' || !/^\d+:\d+$/.test(cursor))) throw new TypeError('invalid cursor');
  const records = listRejectedSubmissions(sDir);
  const [round, attempt] = cursor === null ? [0, 0] : cursor.split(':').map(Number);
  const remaining = records.filter((item) => item.round > round || (item.round === round && item.attempt > attempt));
  const items = remaining.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor: remaining.length > items.length ? `${last.round}:${last.attempt}` : null,
    total_count: records.length,
    reference: 'rounds/',
  };
}

export function pageUnresolvedIssues(dataDir, sessionId, { limit = 20, cursor = null } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('limit must be between 1 and 100');
  if (cursor !== null && (typeof cursor !== 'string' || !/^\d+$/.test(cursor))) throw new TypeError('invalid cursor');
  const events = readIssueLedger(dataDir, sessionId);
  const issues = new Map();
  events.forEach((event, index) => {
    const previous = issues.get(event.issue_id);
    issues.set(event.issue_id, {
      issue_id: event.issue_id,
      first_sequence: previous?.first_sequence ?? index + 1,
      blocking: event.blocking === true || previous?.blocking === true,
      state: event.lifecycle === 'resolved' ? 'resolved' : 'open',
    });
  });
  const unresolved = [...issues.values()].filter((issue) => issue.state === 'open' && issue.blocking)
    .sort((a, b) => a.first_sequence - b.first_sequence);
  const remaining = unresolved.filter((issue) => issue.first_sequence > Number(cursor ?? 0));
  const items = remaining.slice(0, limit);
  return {
    items,
    next_cursor: remaining.length > items.length ? String(items.at(-1).first_sequence) : null,
    total_count: unresolved.length,
    ledger_ref: { path: 'issue-ledger.jsonl', event_count: events.length, head_hash: events.at(-1)?.hash ?? null },
  };
}

import path from 'node:path';
import fs from 'node:fs';
import { writeJson, readJson } from '../store/atomic.js';

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

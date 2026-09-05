import path from 'node:path';
import fs from 'node:fs';
import { writeJson } from '../store/atomic.js';

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

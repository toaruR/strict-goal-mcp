import fs from 'node:fs';
import path from 'node:path';

export const DIR_NAMES = [
  'sessions',
  'chains',
  'idempotency',
  'locks',
  'audit',
  'rebases',
  'test_inventory'
];

export function ensureStoreDirs(baseDir) {
  if (!baseDir) return null;
  const dirs = {};
  for (const name of DIR_NAMES) {
    const fullPath = path.join(baseDir, name);
    fs.mkdirSync(fullPath, { recursive: true });
    dirs[name] = fullPath;
  }
  return dirs;
}

import path from 'node:path';
import fs from 'node:fs';
import { sessionDir } from './session_store.js';
import { MAX_LOG_HISTORY_ROUNDS } from '../config/defaults.js';

export function sessionLogsDir(dataDir, sessionId) {
  return path.join(sessionDir(dataDir, sessionId), 'logs');
}

export function ensureLogsDir(dataDir, sessionId) {
  const dir = sessionLogsDir(dataDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveSessionLog(dataDir, sessionId, filename, content) {
  const dir = ensureLogsDir(dataDir, sessionId);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  rotateSessionLogs(dataDir, sessionId);
  return filePath;
}

export function rotateSessionLogs(dataDir, sessionId, maxKeep = MAX_LOG_HISTORY_ROUNDS) {
  const dir = sessionLogsDir(dataDir, sessionId);
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.log'))
    .map(f => {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      return { name: f, path: fullPath, mtime: stat.mtimeMs };
    })
    .sort((a, b) => (b.mtime !== a.mtime ? b.mtime - a.mtime : b.name.localeCompare(a.name)));

  if (files.length > maxKeep) {
    const toRemove = files.slice(maxKeep);
    for (const file of toRemove) {
      try {
        fs.unlinkSync(file.path);
      } catch {}
    }
  }
}

export function listSessionLogs(dataDir, sessionId) {
  const dir = sessionLogsDir(dataDir, sessionId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.log')).sort();
}

export function readSessionLog(dataDir, sessionId, filename) {
  const filePath = path.join(sessionLogsDir(dataDir, sessionId), filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

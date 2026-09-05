import path from 'node:path';
import fs from 'node:fs';
import { writeJson, readJson } from './atomic.js';

function indexPath(dataDir) {
  return path.join(dataDir, 'index.json');
}

export function readIndex(dataDir) {
  const target = indexPath(dataDir);
  if (!fs.existsSync(target)) {
    return { sessions: {}, labels: {}, chains: {} };
  }
  return readJson(target);
}

export function writeIndex(dataDir, index) {
  writeJson(indexPath(dataDir), index);
}

export function updateIndexForSession(dataDir, { sessionId, state, round, updatedAt, label, chainId }) {
  const index = readIndex(dataDir);
  index.sessions[sessionId] = { state, round, updated_at: updatedAt };

  if (label) {
    index.labels[label] = Array.from(new Set([...(index.labels[label] ?? []), sessionId]));
  }

  if (chainId) {
    index.chains[chainId] = Array.from(new Set([...(index.chains[chainId] ?? []), sessionId]));
  }

  writeIndex(dataDir, index);
  return index;
}

export function resolveByLabel(dataDir, label) {
  const index = readIndex(dataDir);
  const sessionIds = index.labels[label] ?? [];
  return sessionIds.map((sessionId) => ({ session_id: sessionId, ...index.sessions[sessionId] }));
}

export function resolveByChain(dataDir, chainId) {
  const index = readIndex(dataDir);
  return index.chains[chainId] ?? [];
}

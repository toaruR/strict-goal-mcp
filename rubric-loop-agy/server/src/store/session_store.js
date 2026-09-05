import path from 'node:path';
import fs from 'node:fs';
import { writeJson, readJson } from './atomic.js';
import { updateIndexForSession } from './index_store.js';

export function sessionDir(dataDir, sessionId) {
  return path.join(dataDir, 'sessions', sessionId);
}

function sessionPath(dataDir, sessionId) {
  return path.join(sessionDir(dataDir, sessionId), 'session.json');
}

export function writeSession(dataDir, session) {
  const dir = sessionDir(dataDir, session.session_id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(sessionPath(dataDir, session.session_id), session);
  updateIndexForSession(dataDir, {
    sessionId: session.session_id,
    state: session.state,
    round: session.round,
    updatedAt: session.updated_at,
    label: session.label,
    chainId: session.chain_id,
  });
  return session;
}

export function readSession(dataDir, sessionId) {
  return readJson(sessionPath(dataDir, sessionId));
}

export function sessionExists(dataDir, sessionId) {
  return fs.existsSync(sessionPath(dataDir, sessionId));
}

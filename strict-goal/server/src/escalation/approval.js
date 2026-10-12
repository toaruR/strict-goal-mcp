import path from 'node:path';
import fs from 'node:fs';
import { writeJson, readJson } from '../store/atomic.js';

function fail(message, escalationId) {
  const err = new Error(message);
  err.code = 'E_RESOLUTION_NOT_APPLICABLE';
  err.detail = { escalation_id: escalationId };
  throw err;
}

function dir(sDir) { return path.join(sDir, 'escalations'); }
function recordPath(sDir, id) { return path.join(dir(sDir), `${id}.json`); }
function numbers(sDir) {
  if (!fs.existsSync(dir(sDir))) return [];
  return fs.readdirSync(dir(sDir)).flatMap(name => {
    const match = /^esc_(\d+)\.json$/.exec(name);
    return match ? [Number(match[1])] : [];
  });
}
function id(number) { return `esc_${String(number).padStart(2, '0')}`; }

// Interpret existing approval JSON using the current fields, without accessing any companion file.
function normalize(record) {
  const fields = ['escalation_id', 'created_at', 'reason', 'summary_for_human', 'detail',
    'consumed', 'consumed_at', 'resolution', 'human_reply'];
  const result = Object.fromEntries(fields.filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]]));
  result.channel = record.channel === 'mrtr' ? 'mrtr' : record.channel === 'system' ? 'system' : 'chat';
  return result;
}

export function readCurrentEscalation(sDir) {
  const existing = numbers(sDir);
  return existing.length ? normalize(readJson(recordPath(sDir, id(Math.max(...existing))))) : null;
}

export function createApproval(sDir, { reason, summaryForHuman, detail, channel = 'chat' }) {
  fs.mkdirSync(dir(sDir), { recursive: true });
  const existing = numbers(sDir);
  const escalationId = id(existing.length ? Math.max(...existing) + 1 : 1);
  const record = {
    escalation_id: escalationId, created_at: new Date().toISOString(), reason, channel,
    ...(summaryForHuman ? { summary_for_human: summaryForHuman } : {}),
    ...(detail !== undefined ? { detail } : {}),
    consumed: false, consumed_at: null, resolution: null,
  };
  writeJson(recordPath(sDir, escalationId), record);
  return { escalationId, record };
}

export function pendingApproval(sDir, escalationId, { channel } = {}) {
  const record = readCurrentEscalation(sDir);
  if (!record || record.consumed || record.channel === 'system' || record.escalation_id !== escalationId ||
    (channel && record.channel !== channel)) {
    fail('escalation is not an active approval request', escalationId);
  }
  return record;
}

export function consumeApproval(sDir, escalationId, { resolution, humanReply, channel }) {
  const record = pendingApproval(sDir, escalationId, { channel });
  if (typeof humanReply !== 'string' || !humanReply.trim()) fail('an explicit human reply is required', escalationId);
  const updated = { ...record, consumed: true, consumed_at: new Date().toISOString(), resolution, human_reply: humanReply };
  writeJson(recordPath(sDir, escalationId), updated);
  return updated;
}

export function listEscalations(sDir) {
  return numbers(sDir).sort((a, b) => a - b).map(number => normalize(readJson(recordPath(sDir, id(number)))));
}

export function recordSystemEvent(sDir, { reason, resolution }) {
  const { escalationId, record } = createApproval(sDir, { reason, channel: 'system' });
  const updated = { ...record, consumed: true, consumed_at: record.created_at, resolution };
  writeJson(recordPath(sDir, escalationId), updated);
  return { escalationId, record: updated };
}

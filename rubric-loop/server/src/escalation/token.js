import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { writeAtomic, writeJson, readJson } from '../store/atomic.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function escalationsDir(sDir) {
  return path.join(sDir, 'escalations');
}

function jsonPath(sDir, escalationId) {
  return path.join(escalationsDir(sDir), `${escalationId}.json`);
}

function tokenPath(sDir, escalationId) {
  return path.join(escalationsDir(sDir), `${escalationId}.token`);
}

function listEscalationNumbers(sDir) {
  const dir = escalationsDir(sDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => Number.parseInt(name.slice('esc_'.length, -'.json'.length), 10))
    .filter((n) => Number.isInteger(n));
}

function nextEscalationId(sDir) {
  const nums = listEscalationNumbers(sDir);
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `esc_${String(next).padStart(2, '0')}`;
}

function currentEscalationId(sDir) {
  const nums = listEscalationNumbers(sDir);
  if (nums.length === 0) return null;
  return `esc_${String(Math.max(...nums)).padStart(2, '0')}`;
}

// 人間が読むトークンをファイルにのみ書く。応答本文には値を一切載せない（§6.4.6）。
export function createEscalation(sDir, { reason, summaryForHuman, channel = 'token_file' }) {
  const dir = escalationsDir(sDir);
  fs.mkdirSync(dir, { recursive: true });
  const escalationId = nextEscalationId(sDir);
  const token = crypto.randomBytes(24).toString('hex');
  const path_ = tokenPath(sDir, escalationId);
  writeAtomic(path_, `${token}\n`);

  const record = {
    escalation_id: escalationId,
    created_at: new Date().toISOString(),
    reason,
    channel,
    ...(summaryForHuman ? { summary_for_human: summaryForHuman } : {}),
    consumed: false,
    consumed_at: null,
    token_read_at: null,
    resolution: null,
  };
  writeJson(jsonPath(sDir, escalationId), record);
  return { escalationId, tokenPath: path_, record };
}

// §18.3 MRTR 経路。往復がプロトコルの input_required/inputResponses で完結するため、
// トークンファイルを一切作らない（human_token 自体が不要）。
export function createMrtrEscalation(sDir, { reason, summaryForHuman }) {
  const dir = escalationsDir(sDir);
  fs.mkdirSync(dir, { recursive: true });
  const escalationId = nextEscalationId(sDir);
  const record = {
    escalation_id: escalationId,
    created_at: new Date().toISOString(),
    reason,
    channel: 'mrtr',
    ...(summaryForHuman ? { summary_for_human: summaryForHuman } : {}),
    consumed: false,
    consumed_at: null,
    token_read_at: null,
    resolution: null,
  };
  writeJson(jsonPath(sDir, escalationId), record);
  return { escalationId, record };
}

// MRTR 往復の2回目。inputResponses で運ばれた resolution をそのまま適用する
// （human_token との照合は行わない。channel が "mrtr" でない、または既に消費済み／
// 存在しない escalation_id を指す場合は E_TOKEN_INVALID）。
export function resolveMrtrEscalation(sDir, escalationId, { resolution }) {
  const path_ = jsonPath(sDir, escalationId);
  if (!fs.existsSync(path_)) {
    fail('E_TOKEN_INVALID', 'no such escalation for this session', { escalation_id: escalationId });
  }
  const record = readJson(path_);
  if (record.channel !== 'mrtr' || record.consumed) {
    fail('E_TOKEN_INVALID', 'escalation is not a pending MRTR round-trip', { escalation_id: escalationId });
  }
  const consumedAt = new Date().toISOString();
  const updated = { ...record, consumed: true, consumed_at: consumedAt, resolution };
  writeJson(path_, updated);
  return updated;
}

// human_token をファイル内の値と照合し、一致すればその場でトークンを消費する（再利用不可）。
export function consumeToken(sDir, humanToken, { resolution }) {
  const escalationId = currentEscalationId(sDir);
  if (!escalationId) {
    fail('E_TOKEN_INVALID', 'no pending escalation for this session', {});
  }
  const record = readJson(jsonPath(sDir, escalationId));
  const path_ = tokenPath(sDir, escalationId);

  if (record.consumed || !fs.existsSync(path_)) {
    fail('E_TOKEN_INVALID', 'human_token has already been consumed', { escalation_id: escalationId });
  }

  const storedToken = fs.readFileSync(path_, 'utf8').trim();
  if (typeof humanToken !== 'string' || humanToken !== storedToken) {
    fail('E_TOKEN_INVALID', 'human_token does not match', { escalation_id: escalationId });
  }

  fs.unlinkSync(path_);
  const consumedAt = new Date().toISOString();
  const updated = { ...record, consumed: true, consumed_at: consumedAt, token_read_at: consumedAt, resolution };
  writeJson(jsonPath(sDir, escalationId), updated);
  return updated;
}

// audit_export(§12.1 escalations[]) 用。トークンの値そのものは escalations/<id>.token に
// しか無いため、record を丸ごと返しても人間可読トークンの値は漏れない。
export function listEscalations(sDir) {
  const dir = escalationsDir(sDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson(path.join(dir, name)));
}

// human_token を経由しないシステム発の終了（例: STALLED から直接の abort）を監査に残す。
// トークンファイルは作らない（誰も承認する必要がないため）。
export function recordSystemEvent(sDir, { reason, resolution }) {
  const dir = escalationsDir(sDir);
  fs.mkdirSync(dir, { recursive: true });
  const escalationId = nextEscalationId(sDir);
  const createdAt = new Date().toISOString();
  const record = {
    escalation_id: escalationId,
    created_at: createdAt,
    reason,
    consumed: true,
    consumed_at: createdAt,
    token_read_at: null,
    resolution,
  };
  const path_ = jsonPath(sDir, escalationId);
  writeJson(path_, record);
  return { escalationId, tokenPath: path_, record };
}

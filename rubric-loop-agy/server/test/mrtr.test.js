import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { isMrtrSupported, handleMrtrEscalation, completeMrtrEscalation } from '../src/mcp/mrtr.js';
import { sessionDir } from '../src/store/session_store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-mrtr-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-mrtr-${submissionCounter}`.padEnd(8, '0');
}

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: {
        criteria: [
          {
            id: 'impl_works',
            statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
            weight: 1,
            verification: 'manual',
            anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
          },
        ],
        policy: {},
      },
    },
    persistence,
  });
}

test('MRTR に対応するホストでは escalate の承認が往復1回で完了し、token 値が応答本文に含まれない', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const sDir = sessionDir(persistence.dir, created.session_id);

  assert.equal(isMrtrSupported({ elicitation: true }), true);

  // 往復1回目: サーバは input_required を返す
  const req = handleMrtrEscalation({
    session: created,
    sDir,
    persistence,
    clientCapabilities: { elicitation: true },
    note: '停滞しています。人間の指示を仰ぎます。40文字以上の説明文。',
  });

  assert.equal(req.channel, 'mrtr');
  assert.equal(req.resultType, 'input_required');
  assert.ok(req.requestState.escalation_id);
  assert.equal(req.requestState.session_id, created.session_id);
  assert.ok(req.inputRequests.length > 0);
  assert.equal(JSON.stringify(req).includes('human_token'), false);

  // 往復2回目: 人間の応答をつけて完了
  const complete = completeMrtrEscalation({
    requestState: req.requestState,
    inputResponses: { resolution: 'continue' },
    persistence,
  });

  assert.equal(complete.resultType, 'complete');
  assert.equal(complete.state, 'DRAFTING');
  assert.equal(complete.resolution, 'continue');
  assert.equal(JSON.stringify(complete).includes('human_token'), false);
});

test('MRTR 非対応のホストでは token ファイル方式に自動で縮退し warnings に mrtr_unavailable が出る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const sDir = sessionDir(persistence.dir, created.session_id);

  assert.equal(isMrtrSupported({}), false);

  const fallback = handleMrtrEscalation({
    session: created,
    sDir,
    persistence,
    clientCapabilities: {},
    note: '停滞しています。人間の指示を仰ぎます。40文字以上の説明文。',
  });

  assert.equal(fallback.channel, 'token_file');
  assert.equal(fallback.state, 'ESCALATED');
  assert.deepEqual(fallback.warnings, ['mrtr_unavailable']);
  assert.ok(fallback.token_path);
  assert.ok(existsSync(fallback.token_path));

  // トークン値は応答本文に含まれない
  const tokenVal = readFileSync(fallback.token_path, 'utf8').trim();
  assert.equal(JSON.stringify(fallback).includes(tokenVal), false);
});

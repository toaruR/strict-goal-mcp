import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-amend-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-amend-${submissionCounter}`.padEnd(8, '0');
}

const CRITERION_A = {
  id: 'impl_works',
  statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
  weight: 2,
  verification: 'manual',
  anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
};
const CRITERION_B = {
  id: 'docs_clear',
  statement: '文書が第三者にも明快に伝わることの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '不明瞭で読めない', 5: 'まあまあ読める', 9: '非常に明瞭' },
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION_A, CRITERION_B] },
    },
    persistence,
  });
}

function amend(persistence, sessionId, overrides = {}) {
  return rubricAmend({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      criteria: [CRITERION_A, CRITERION_B],
      reason: 'a'.repeat(45),
      ...overrides,
    },
    persistence,
  });
}

test('SCORING で rubric_amend を呼ぶと E_STATE_VIOLATION になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: '# 設計書\n本文',
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  assert.throws(() => amend(persistence, created.session_id), { code: 'E_STATE_VIOLATION' });
});

test('緩和を含む変更を acknowledge_relaxation なしで出すと E_RELAXATION_UNACKNOWLEDGED になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const loweredWeight = { ...CRITERION_A, weight: 1 };

  assert.throws(
    () => amend(persistence, created.session_id, { criteria: [loweredWeight, CRITERION_B] }),
    { code: 'E_RELAXATION_UNACKNOWLEDGED' },
  );

  const result = amend(persistence, created.session_id, {
    criteria: [loweredWeight, CRITERION_B],
    acknowledge_relaxation: true,
  });
  assert.equal(result.classification, 'relaxation');
  assert.equal(result.final_reachable, false);
  assert.equal(result.relaxation_count, 1);
});

// 設計書 §6.4.5 の入力スキーマは additionalProperties:false で policy を受け付けない
// （E_THRESHOLD_IMMUTABLE はこの経路では構造的に発生し得ないと設計書自身が明記している。
//  §14.3.4 のエラーコード全数検査、および CLAUDE.md のハマりポイント参照）。
test('入力に policy を含めると E_VALIDATION になる(スキーマが policy を受け付けないため)', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  assert.throws(
    () =>
      rubricAmend({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          criteria: [CRITERION_A, CRITERION_B],
          reason: 'a'.repeat(45),
          policy: { pass_score: 5 },
        },
        persistence,
      }),
    { code: 'E_VALIDATION' },
  );
});

test('reason が39文字のとき E_VALIDATION、40文字は通る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  assert.throws(() => amend(persistence, created.session_id, { reason: 'a'.repeat(39) }), { code: 'E_VALIDATION' });

  const result = amend(persistence, created.session_id, { reason: 'a'.repeat(40) });
  assert.equal(result.ok, true);
});

test('受理されると rubric/<n+1>.json と rubric_diff/<n+1>.json の両方が作られる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const sDir = path.join(persistence.dir, 'sessions', created.session_id);

  const criterionC = {
    id: 'style_ok',
    statement: '文体が一貫し誤字脱字が無いことの根拠が十分に示されている',
    weight: 1,
    verification: 'manual',
    anchors: { 1: '文体がばらばら', 5: 'おおむね統一', 9: '完全に統一' },
  };

  const result = amend(persistence, created.session_id, { criteria: [CRITERION_A, CRITERION_B, criterionC] });
  assert.equal(result.rubric_version, 2);
  assert.equal(result.classification, 'addition');
  assert.ok(existsSync(path.join(sDir, 'rubric', '2.json')));
  assert.ok(existsSync(path.join(sDir, 'rubric_diff', '2.json')));
});

test('expected_round 不一致のとき E_CONCURRENT になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  assert.throws(() => amend(persistence, created.session_id, { expected_round: 2 }), { code: 'E_CONCURRENT' });
});

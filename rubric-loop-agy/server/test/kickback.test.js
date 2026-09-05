import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { escalate } from '../src/tools/escalate.js';
import { readChain } from '../src/chain/store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-kickback-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-kb-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'これは40文字以上ある差し戻しの理由の説明文です。上流の設計に問題が見つかりました。';
const CONTENT = '# 文書\n実装は完全に動作することを実行ログで確認したという記録がある。';
const EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';
const CONTENT_V2 = '# 文書\n実装は完全に動作することを実行ログで確認したという記録がある。\n新しい修正の記録が詳細に追加されました。';
const EXCERPT_V2 = '新しい修正の記録が詳細に追加されました。';

function oneCriterionRubric() {
  return {
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
  };
}

function createDesign(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: oneCriterionRubric(),
    },
    persistence,
  });
}

function createPlan(persistence, upstream) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'plan',
      upstream,
      rubric: oneCriterionRubric(),
    },
    persistence,
  });
}

function commitAndFinalize(persistence, sessionId, content = CONTENT, excerpt = EXCERPT) {
  const c1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  const r1 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}

function sessionJsonPath(persistence, sessionId) {
  return path.join(persistence.dir, 'sessions', sessionId, 'session.json');
}

function readSessionRaw(persistence, sessionId) {
  return JSON.parse(readFileSync(sessionJsonPath(persistence, sessionId), 'utf8'));
}

test('kickback 後に下流の state が FROZEN、上流の state が DRAFTING になり chain.json に記録される', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = commitAndFinalize(persistence, design.session_id);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });

  const result = escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'kickback',
      human_token: 'valid-token-for-human-approval',
      target_criteria: ['impl_works'],
      note: NOTE,
    },
    persistence,
  });

  assert.equal(result.state, 'FROZEN');

  const planSession = readSessionRaw(persistence, plan.session_id);
  assert.equal(planSession.state, 'FROZEN');

  const designSession = readSessionRaw(persistence, design.session_id);
  assert.equal(designSession.state, 'DRAFTING');
  assert.equal(designSession.round, 2);
  assert.equal(designSession.reopened.length, 1);
  assert.equal(designSession.reopened[0].by, 'kickback');
  assert.equal(designSession.reopened[0].from_session, plan.session_id);

  const chain = readChain(persistence.dir, plan.chain_id);
  assert.equal(chain.kickbacks.length, 1);
  assert.equal(chain.kickbacks[0].from, plan.session_id);
  assert.equal(chain.kickbacks[0].to, design.session_id);
});

test('FROZEN では artifact_commit / score_submit / rubric_amend が E_FROZEN で拒否される', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = commitAndFinalize(persistence, design.session_id);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });

  escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'kickback',
      human_token: 'valid-token-for-human-approval',
      target_criteria: ['impl_works'],
      note: NOTE,
    },
    persistence,
  });

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          content: CONTENT,
          change_note: 'これは20文字以上ある変更理由の説明文です',
        },
        persistence,
      }),
    { code: 'E_FROZEN' },
  );

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: `sha256:${'0'.repeat(64)}`,
          scores: [
            {
              criterion_id: 'impl_works',
              score: 9,
              rationale: 'a'.repeat(45),
              weakness: 'b'.repeat(15),
              evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
            },
          ],
        },
        persistence,
      }),
    { code: 'E_FROZEN' },
  );

  assert.throws(
    () =>
      rubricAmend({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          criteria: [oneCriterionRubric().criteria[0]],
          reason: 'a'.repeat(45),
        },
        persistence,
      }),
    { code: 'E_FROZEN' },
  );
});

test('FROZEN では escalate の abort だけが通り、他の action は E_STATE_VIOLATION になる', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = commitAndFinalize(persistence, design.session_id);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });

  escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'kickback',
      human_token: 'valid-token-for-human-approval',
      target_criteria: ['impl_works'],
      note: NOTE,
    },
    persistence,
  });

  assert.throws(
    () =>
      escalate({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          action: 'request_human',
          note: NOTE,
        },
        persistence,
      }),
    { code: 'E_STATE_VIOLATION' },
  );

  assert.throws(
    () =>
      escalate({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          action: 'rebase',
          upstream_digest: `sha256:${'a'.repeat(64)}`,
          note: NOTE,
        },
        persistence,
      }),
    { code: 'E_STATE_VIOLATION' },
  );

  const aborted = escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'abort',
      note: NOTE,
    },
    persistence,
  });
  assert.equal(aborted.state, 'ABORTED');
});

test('上流が再び FINAL になると下流が FROZEN から SUPERSEDED を経由して rebase 可能になる', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest1 = commitAndFinalize(persistence, design.session_id);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest1 });

  escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'kickback',
      human_token: 'valid-token-for-human-approval',
      target_criteria: ['impl_works'],
      note: NOTE,
    },
    persistence,
  });

  // 上流 (design) が round 2 で再度 commit して FINAL になる
  const c2 = artifactCommit({
    input: {
      session_id: design.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content: CONTENT_V2,
      change_note: 'これは20文字以上ある変更理由の説明文です',
      addresses: ['impl_works'],
    },
    persistence,
  });
  const r2 = scoreSubmit({
    input: {
      session_id: design.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      artifact_digest: c2.artifact.digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_V2 }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r2.verdict, 'FINAL');
  const designDigest2 = c2.artifact.digest;

  // 下流の loop_state を呼ぶと SUPERSEDED に遷移する
  const st = loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(st.state, 'SUPERSEDED');

  // rebase を呼んで DRAFTING に復帰できる
  const rebased = escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'rebase',
      upstream_digest: designDigest2,
      note: NOTE,
    },
    persistence,
  });
  assert.equal(rebased.state, 'DRAFTING');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';
import { saveContentArtifact } from '../src/artifact/store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-rebase-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-reb-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const SENTENCE_KEEP = '実装は完全に動作することを実行ログで確認したという記録がここにある。';
const SENTENCE_REMOVE = '古い設計方針に基づく暫定的な確認記録がここに書かれている。';
const DESIGN_CONTENT_V1 = `# 設計\n${SENTENCE_KEEP}\n${SENTENCE_REMOVE}`;
const DESIGN_CONTENT_V2 = `# 設計\n${SENTENCE_KEEP}\n新しい方針に基づく別の確認記録に置き換えられている。`;
const PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これは40文字以上の長さを確実に満たす実装計画全体の概要説明文です。十分な文字数を確保しています。',
  tasks: [
    {
      id: 'T001',
      title: '実装計画がここに詳細に記述されている一つの文章です。',
      intent: 'このタスクの意図を20文字以上で説明する文章です。',
      depends_on: [],
      design_refs: ['# 設計'],
      changes: [{ path: 'src/a.js', kind: 'add' }],
      acceptance: ['受け入れ条件が満たされること'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ],
});

function planRubric() {
  return {
    criteria: [
      {
        id: 'crit_keep',
        statement: '上流設計の維持される節を根拠にできることの確認',
        weight: 1,
        verification: 'manual',
        anchors: { 1: '根拠が全くない', 5: '一部だけ根拠がある', 9: '十分な根拠がある' },
      },
      {
        id: 'crit_remove',
        statement: '上流設計の失効する節を根拠にできることの確認',
        weight: 1,
        verification: 'manual',
        anchors: { 1: '根拠が全くない', 5: '一部だけ根拠がある', 9: '十分な根拠がある' },
      },
      {
        id: 'crit_local',
        statement: '計画自身の記述だけで完結する根拠の確認',
        weight: 1,
        verification: 'manual',
        anchors: { 1: '根拠が全くない', 5: '一部だけ根拠がある', 9: '十分な根拠がある' },
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

function createPlan(persistence, upstream) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'plan',
      upstream,
      rubric: planRubric(),
    },
    persistence,
  });
}

function finalizeDesign(persistence, sessionId) {
  const c1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content: DESIGN_CONTENT_V1,
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
          evidence: [{ kind: 'locator', locator: '§1', excerpt: SENTENCE_KEEP }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}

function finalizePlan(persistence, sessionId) {
  const c1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content: PLAN_CONTENT,
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
          criterion_id: 'crit_keep',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'upstream', upstream_locator: '§1', excerpt: SENTENCE_KEEP }],
        },
        {
          criterion_id: 'crit_remove',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'upstream', upstream_locator: '§2', excerpt: SENTENCE_REMOVE }],
        },
        {
          criterion_id: 'crit_local',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: PLAN_CONTENT }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
}

function sessionJsonPath(persistence, sessionId) {
  return path.join(persistence.dir, 'sessions', sessionId, 'session.json');
}

function readSessionRaw(persistence, sessionId) {
  return JSON.parse(readFileSync(sessionJsonPath(persistence, sessionId), 'utf8'));
}

function writeSessionRaw(persistence, sessionId, session) {
  writeFileSync(sessionJsonPath(persistence, sessionId), JSON.stringify(session, null, 2));
}

// reopen/kickback (T043) 未実装のため、上流の再確定は design session の artifacts/session.json を
// 直接書き換えて再現する(supersede.test.js と同じ理由)。
function mutateDesignToV2(persistence, designSessionId) {
  const sDir = path.join(persistence.dir, 'sessions', designSessionId);
  const { digest, bytes } = saveContentArtifact(sDir, 'markdown', DESIGN_CONTENT_V2);
  const raw = readSessionRaw(persistence, designSessionId);
  raw.current_artifact = { digest, bytes, committed_at: new Date().toISOString() };
  writeSessionRaw(persistence, designSessionId, raw);
  return digest;
}

function buildSupersededPlan(persistence) {
  const design = createDesign(persistence);
  const designDigestV1 = finalizeDesign(persistence, design.session_id);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigestV1 });
  finalizePlan(persistence, plan.session_id);

  const designDigestV2 = mutateDesignToV2(persistence, design.session_id);
  loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'SUPERSEDED');

  return { design, plan, designDigestV2 };
}

test('rebase すると carry_over/invalidated に正しく分類され、state が DRAFTING に戻り round が進む', () => {
  const persistence = durablePersistence();
  const { plan, designDigestV2 } = buildSupersededPlan(persistence);

  const result = escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'rebase',
      upstream_digest: designDigestV2,
      note: NOTE,
    },
    persistence,
  });

  assert.equal(result.state, 'DRAFTING');

  const sDir = path.join(persistence.dir, 'sessions', plan.session_id);
  const rebaseFiles = readdirSync(path.join(sDir, 'rebases'));
  assert.equal(rebaseFiles.length, 1);
  const record = JSON.parse(readFileSync(path.join(sDir, 'rebases', rebaseFiles[0]), 'utf8'));
  assert.deepEqual(record.carried_over.sort(), ['crit_keep', 'crit_local']);
  assert.deepEqual(record.invalidated, ['crit_remove']);
  assert.equal(record.to_digest, designDigestV2);

  const sessionAfter = readSessionRaw(persistence, plan.session_id);
  assert.equal(sessionAfter.round, 2);
  assert.equal(sessionAfter.upstream.artifact_digest, designDigestV2);
  assert.ok(!sessionAfter.last_evaluation.scores.some((s) => s.criterion_id === 'crit_remove'));
  assert.ok(sessionAfter.last_evaluation.scores.some((s) => s.criterion_id === 'crit_keep'));
  assert.deepEqual(
    sessionAfter.last_evaluation.must_fix.map((m) => m.criterion_id),
    ['crit_remove'],
  );
});

test('存在しない上流セッションを指すと E_UPSTREAM_NOT_FOUND になる', () => {
  const persistence = durablePersistence();
  const { plan } = buildSupersededPlan(persistence);

  const raw = readSessionRaw(persistence, plan.session_id);
  raw.upstream = { ...raw.upstream, session_id: 'sess_does_not_exist' };
  writeSessionRaw(persistence, plan.session_id, raw);

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
    { code: 'E_UPSTREAM_NOT_FOUND' },
  );
});

test('upstream_digest が上流の実際の確定成果物と食い違うと E_UPSTREAM_DIGEST_MISMATCH になる', () => {
  const persistence = durablePersistence();
  const { plan } = buildSupersededPlan(persistence);

  assert.throws(
    () =>
      escalate({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          action: 'rebase',
          upstream_digest: `sha256:${'b'.repeat(64)}`,
          note: NOTE,
        },
        persistence,
      }),
    { code: 'E_UPSTREAM_DIGEST_MISMATCH' },
  );
});

test('SUPERSEDED でない状態から rebase を呼ぶと E_STATE_VIOLATION になる', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalizeDesign(persistence, design.session_id);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });

  assert.throws(
    () =>
      escalate({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          action: 'rebase',
          upstream_digest: designDigest,
          note: NOTE,
        },
        persistence,
      }),
    { code: 'E_STATE_VIOLATION' },
  );
});

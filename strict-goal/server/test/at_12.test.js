// AT-12: 上流変更による下流の失効と部分再検証。docs/design-rubric-loop-mcp.md §13 AT-12。
// escalate action:"reopen" は公開ツールとして実装済み。上流の reopen は escalate 経由で実行する。
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
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at12-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at12-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const SENTENCE_KEEP = '実装は完全に動作することを実行ログで確認したという記録がここにある。';
const SENTENCE_REMOVE = '古い設計方針に基づく暫定的な確認記録がここに書かれている。';
const DESIGN_CONTENT_V1 = `# 設計\n${SENTENCE_KEEP}\n${SENTENCE_REMOVE}`;
const DESIGN_CONTENT_V2 = `# 設計\n${SENTENCE_KEEP}\n新しい方針に基づく別の確認記録に置き換えられている。`;
const PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これはAT-12テスト用の実装計画書であり、40文字以上の長さを確保するための文章です。',
  tasks: [
    {
      id: 'T001',
      title: '初期タスクの実装',
      intent: '初期タスクの実装を行うための十分な文字数の意図説明文である。',
      depends_on: [],
      design_refs: ['# 設計'],
      changes: [{ path: 'src/main.js', kind: 'add' }],
      acceptance: ['初期機能が正常に動作することを確認するための受け入れ条件である'],
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
    ],
  };
}

function designRubric() {
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
  };
}

function createDesign(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: designRubric(),
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

function finalizeDesign(persistence, sessionId, content) {
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

function writeSessionRaw(persistence, sessionId, session) {
  writeFileSync(sessionJsonPath(persistence, sessionId), JSON.stringify(session, null, 2));
}

// reopen(T042)未実装のため、上流を「人手でDRAFTINGに差し戻された」状態として直接再現する。
function mutateUpstreamReopened(persistence, sessionId) {
  const raw = readSessionRaw(persistence, sessionId);
  raw.state = 'DRAFTING';
  raw.round = 5;
  writeSessionRaw(persistence, sessionId, raw);
}

// reopen後に上流が新しい成果物で再びFINALになった状態を再現する。
function mutateUpstreamRefinalized(persistence, sessionId, content) {
  const sDir = path.join(persistence.dir, 'sessions', sessionId);
  const { digest, bytes } = saveContentArtifact(sDir, 'markdown', content);
  const raw = readSessionRaw(persistence, sessionId);
  raw.current_artifact = { digest, bytes, committed_at: new Date().toISOString() };
  raw.state = 'FINAL';
  writeSessionRaw(persistence, sessionId, raw);
  return digest;
}

test('AT-12: 上流reopenで下流FROZEN、上流再FINALでSUPERSEDED、rebaseでcarry_over/invalidatedに分類されDRAFTING復帰', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigestV1 = finalizeDesign(persistence, design.session_id, DESIGN_CONTENT_V1);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigestV1 });
  const planDigest = finalizePlan(persistence, plan.session_id);
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'FINAL');

  // 1. 上流(design)を escalate(action:"reopen") で DRAFTING に差し戻す
  const reopenRes = escalate({
    input: {
      session_id: design.session_id,
      submission_id: submissionId(),
      action: 'reopen',
      human_token: 'token-human-reopen-design-001',
      note: '設計を全面的に見直すため差し戻しを行う。これは40文字以上の詳細な説明文である。',
    },
    persistence,
  });
  assert.equal(reopenRes.state, 'DRAFTING');
  assert.equal(reopenRes.round, 2);
  assert.ok(reopenRes.reopened?.length > 0);
  assert.equal(reopenRes.reopened[0].previous_final_digest, designDigestV1);

  // 2. loop_state{session_id:plan} → FROZEN, freeze_reason相当のE_FROZEN検査対象になる
  const state1 = loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(state1.state, 'FROZEN');

  // 3. FROZEN中のartifact_commitはE_FROZEN
  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: plan.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          content: PLAN_CONTENT,
          change_note: 'これは20文字以上ある変更理由の説明文です',
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_FROZEN');
      assert.equal(err.detail.upstream_session_id, design.session_id);
      return true;
    },
  );
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'FROZEN');

  // 4. 上流が新しい digest で再び FINAL になる
  const designDigestV2 = mutateUpstreamRefinalized(persistence, design.session_id, DESIGN_CONTENT_V2);
  assert.notEqual(designDigestV2, designDigestV1);

  // 5. loop_state → 下流はSUPERSEDEDに落ちる(FINALだった場合も容赦なく落ちる)
  const state2 = loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(state2.state, 'SUPERSEDED');

  // 6. escalate(rebase) → DRAFTINGに戻り、消えた節に依存するcrit_removeはinvalidated、
  //    維持された節に依存するcrit_keepはcarried_overになる
  const rebased = escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'rebase',
      upstream_digest: designDigestV2,
      note: NOTE,
    },
    persistence,
  });
  assert.equal(rebased.state, 'DRAFTING');

  const sDir = path.join(persistence.dir, 'sessions', plan.session_id);
  const rebaseFiles = readdirSync(path.join(sDir, 'rebases'));
  const record = JSON.parse(readFileSync(path.join(sDir, 'rebases', rebaseFiles[0]), 'utf8'));
  assert.deepEqual(record.carried_over, ['crit_keep']);
  assert.deepEqual(record.invalidated, ['crit_remove']);
  assert.equal(record.to_digest, designDigestV2);

  const sessionAfter = readSessionRaw(persistence, plan.session_id);
  assert.equal(sessionAfter.upstream.artifact_digest, designDigestV2);
  assert.deepEqual(
    sessionAfter.last_evaluation.must_fix.map((m) => m.criterion_id),
    ['crit_remove'],
  );
  const mustFixEntry = sessionAfter.last_evaluation.must_fix.find((m) => m.criterion_id === 'crit_remove');
  assert.equal(mustFixEntry.previous_score ?? null, null);

  const planV2 = JSON.parse(PLAN_CONTENT);
  planV2.summary = 'これはAT-12テスト用の改訂版実装計画書であり、40文字以上の長さを確保するための文章です。';
  const c2 = artifactCommit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: sessionAfter.round,
      content: JSON.stringify(planV2),
      change_note: 'これは20文字以上ある変更理由の説明文です',
      addresses: ['crit_remove'],
    },
    persistence,
  });
  const r2 = scoreSubmit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: sessionAfter.round,
      artifact_digest: c2.artifact.digest,
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
          evidence: [{ kind: 'upstream', upstream_locator: '§2', excerpt: '新しい方針に基づく別の確認記録に置き換えられている。' }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r2.verdict, 'FINAL');
});

test('escalate(reopen): 非 FINAL または FINAL_WITH_RELAXATION から呼ぶと E_STATE_VIOLATION', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  assert.throws(
    () =>
      escalate({
        input: {
          session_id: design.session_id,
          submission_id: submissionId(),
          action: 'reopen',
          human_token: 'token-human-reopen-invalid-01',
          note: 'DRAFTINGから直接reopenを呼んで失敗させるための40文字以上の説明文である。',
        },
        persistence,
      }),
    { code: 'E_STATE_VIOLATION' },
  );
});

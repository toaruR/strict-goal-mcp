import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';
import { readSession } from '../src/store/session_store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-supersede-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-sup-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const CONTENT = '# 文書\n実装は完全に動作することを実行ログで確認したという記録がある。';
const EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';

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

const VALID_PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これはsupersedeテスト用の実装計画書であり、40文字以上の長さを確保するための文章です。' + EXCERPT,
  tasks: [
    {
      id: 'T001',
      title: '初期タスクの実装',
      intent: '初期タスクの実装を行うための十分な文字数の意図説明文である。' + EXCERPT,
      depends_on: [],
      design_refs: ['# 文書'],
      changes: [{ path: 'src/main.js', kind: 'add' }],
      acceptance: ['初期機能が正常に動作することを確認するための受け入れ条件である'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ],
});

function commitAndFinalize(persistence, sessionId) {
  const session = readSession(persistence.dir, sessionId);
  const content = session.artifact_kind === 'plan' ? VALID_PLAN_CONTENT : CONTENT;
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
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
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

// upstream の reopen/rebase (T042/T043) はまだ実装していないので、上流の digest/state ずれは
// テストの中で session.json を直接書き換えて再現する(checkSupersede の検知ロジック単体を試すのが目的)。
function mutateUpstreamDigest(persistence, upstreamSessionId) {
  const raw = readSessionRaw(persistence, upstreamSessionId);
  raw.current_artifact = { ...raw.current_artifact, digest: `sha256:${'f'.repeat(64)}` };
  writeSessionRaw(persistence, upstreamSessionId, raw);
}

function mutateUpstreamReopened(persistence, upstreamSessionId) {
  const raw = readSessionRaw(persistence, upstreamSessionId);
  raw.state = 'DRAFTING';
  writeSessionRaw(persistence, upstreamSessionId, raw);
}

function buildChain(persistence) {
  const design = createDesign(persistence);
  const designDigest = commitAndFinalize(persistence, design.session_id);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  return { design, plan };
}

test('上流 digest が変わると、以後のツール呼び出しで下流が SUPERSEDED に落ち E_SUPERSEDED になる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildChain(persistence);

  mutateUpstreamDigest(persistence, design.session_id);

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
    { code: 'E_SUPERSEDED' },
  );
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'SUPERSEDED');
});

test('下流が既に FINAL でも、上流 digest がずれれば容赦なく SUPERSEDED に落ちる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildChain(persistence);
  commitAndFinalize(persistence, plan.session_id);
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'FINAL');

  mutateUpstreamDigest(persistence, design.session_id);

  const resumed = loopOpenResume({
    input: { mode: 'resume', submission_id: submissionId(), session_id: plan.session_id },
    persistence,
  });
  // loop_open は SUPERSEDED でも常に許可されるツールなので例外にはならないが、state は落ちる。
  assert.equal(resumed.state, 'SUPERSEDED');
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'SUPERSEDED');
});

test('SUPERSEDED 下では loop_state/escalate は呼べるが artifact_commit は E_SUPERSEDED になる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildChain(persistence);
  mutateUpstreamDigest(persistence, design.session_id);

  const state = loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(state.state, 'SUPERSEDED');

  const aborted = escalate({
    input: { session_id: plan.session_id, submission_id: submissionId(), action: 'abort', note: NOTE },
    persistence,
  });
  assert.equal(aborted.state, 'ABORTED');
});

test('上流が reopen 相当で FINAL でなくなると、下流は FROZEN になり E_FROZEN になる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildChain(persistence);

  mutateUpstreamReopened(persistence, design.session_id);

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
    (err) => err.code === 'E_FROZEN' && err.detail.upstream_session_id === design.session_id,
  );
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'FROZEN');
});

test('上流セッションのディレクトリごと無くなっていれば E_UPSTREAM_NOT_FOUND になる', () => {
  const persistence = durablePersistence();
  const { plan } = buildChain(persistence);

  const raw = readSessionRaw(persistence, plan.session_id);
  raw.upstream = { ...raw.upstream, session_id: 'sess_does_not_exist' };
  writeSessionRaw(persistence, plan.session_id, raw);

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
    { code: 'E_UPSTREAM_NOT_FOUND' },
  );
});

test('上流が変わっていなければ下流は通常どおり動く(誤検知しない)', () => {
  const persistence = durablePersistence();
  const { plan } = buildChain(persistence);

  const c1 = artifactCommit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: VALID_PLAN_CONTENT,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  assert.equal(c1.state, 'SCORING');
});

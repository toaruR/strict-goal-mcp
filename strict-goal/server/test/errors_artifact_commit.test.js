// T069: artifact_commit のエラー13件を全数検査する（設計書 19.6.7 総覧・6.4.3）。
// 19.6.7 本文が挙げる E_PLAN_SCHEMA/E_PLAN_INVALID/E_PLAN_DESIGN_REF は、content 経路が
// checkPlan/validatePlanSchema/design_refs を一切呼ばないため実装上は到達不能（CLAUDE.md
// ハマりポイント参照）。代わりに実際に到達する E_SESSION_NOT_FOUND/E_TEST_REGRESSION/
// E_UPSTREAM_NOT_FOUND を対象にした、src/errors/codes.js の補正後レジストリを正として検査する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { computeManifestDigest } from '../src/artifact/fileset.js';
import { TOOL_ERRORS } from '../src/errors/codes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');
const CHANGE_NOTE = 'これは20文字以上ある変更理由の説明文です';
const NOTE = 'a'.repeat(45);
const VALID_PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これはテスト用の有効な計画サマリー文字列であり、長さが40文字以上になるように長めに記述しています。',
  tasks: [
    {
      id: 'T001',
      title: 'タスク1のタイトル',
      intent: 'タスク1の意図を20文字以上で記述するための文字列です',
      depends_on: [],
      design_refs: ['# 設計'],
      changes: [{ path: 'src/a.js', kind: 'add' }],
      acceptance: ['受け入れ条件1が10文字以上'],
      verify: [{ command: 'node --test', expect_exit_code: 0 }],
    },
  ],
});

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-errors-commit-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-ecommit-${submissionCounter}`.padEnd(8, '0');
}

function oneCriterionRubric(criterionId, verification = 'manual') {
  return {
    criteria: [
      {
        id: criterionId,
        statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
        weight: 1,
        verification,
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
      rubric: oneCriterionRubric('impl_works'),
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
      rubric: oneCriterionRubric('plan_works'),
    },
    persistence,
  });
}

function createImplement(persistence, upstream) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'implement',
      upstream,
      rubric: oneCriterionRubric('tests_green'),
    },
    persistence,
  });
}

function finalize(persistence, sessionId, content, criterionId) {
  const c1 = artifactCommit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: 1, content, change_note: CHANGE_NOTE },
    persistence,
  });
  const r1 = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [{ criterion_id: criterionId, score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: content }] }],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}

function buildDesignPlanChain(persistence) {
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  return { design, plan };
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

function file(p, byte, role = 'test') {
  return { path: p, sha256: byte.repeat(64), bytes: 100, role };
}
function makeTests(n, filePath) {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, file: filePath, status: 'passed' }));
}

function commitFileset(persistence, sessionId, expectedRound, files, testInventory, addresses = undefined) {
  const manifestDigest = computeManifestDigest(files);
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      files,
      manifest_command: 'find . -type f | sort',
      manifest_output_sha256: manifestDigest,
      test_inventory: testInventory,
      change_note: CHANGE_NOTE,
      ...(addresses ? { addresses } : {}),
    },
    persistence,
  });
}

const seen = new Set();
function expectCode(code, fn) {
  test(`artifact_commit: ${code}`, () => {
    assert.throws(fn, { code });
    seen.add(code);
  });
}

expectCode('E_VALIDATION', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  artifactCommit({ input: { session_id: design.session_id, submission_id: submissionId(), expected_round: 1, change_note: 'too short' }, persistence });
});

expectCode('E_SESSION_NOT_FOUND', () => {
  const persistence = durablePersistence();
  artifactCommit({
    input: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY', submission_id: submissionId(), expected_round: 1, content: '# x', change_note: CHANGE_NOTE },
    persistence,
  });
});

expectCode('E_STATE_VIOLATION', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  artifactCommit({ input: { session_id: design.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文', change_note: CHANGE_NOTE }, persistence });
  artifactCommit({ input: { session_id: design.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文2', change_note: CHANGE_NOTE }, persistence });
});

expectCode('E_CONCURRENT', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  artifactCommit({ input: { session_id: design.session_id, submission_id: submissionId(), expected_round: 99, content: '# 本文', change_note: CHANGE_NOTE }, persistence });
});

expectCode('E_ADDRESS_MISSING', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  artifactCommit({ input: { session_id: design.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文1', change_note: CHANGE_NOTE }, persistence });
  let session = readSession(persistence.dir, design.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  session.last_evaluation = { scores: [{ criterion_id: 'impl_works', score: 3, passed: false }], must_fix: [{ criterion_id: 'impl_works', score: 3, gap: 6, anchor_9: '9点相当', verify_hint: '検証方法' }] };
  writeSession(persistence.dir, session);
  artifactCommit({ input: { session_id: design.session_id, submission_id: submissionId(), expected_round: 2, content: '# 本文2', change_note: CHANGE_NOTE, addresses: ['other_crit'] }, persistence });
});

expectCode('E_ARTIFACT_KIND_MISMATCH', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  artifactCommit({
    input: {
      session_id: design.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      files: [file('src/a.js', 'a', 'source')],
      manifest_command: 'find . -type f | sort',
      manifest_output_sha256: computeManifestDigest([file('src/a.js', 'a', 'source')]),
      test_inventory: { source_command: 'npm test', source_exit_code: 0, source_output_sha256: 'c'.repeat(64), counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, tests: [], removed_tests: [] },
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
});

expectCode('E_MANIFEST_UNVERIFIABLE', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, VALID_PLAN_CONTENT, 'plan_works');
  const implement = createImplement(persistence, { session_id: plan.session_id, artifact_digest: planDigest });
  artifactCommit({
    input: {
      session_id: implement.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      files: [file('src/a.js', 'a', 'source')],
      manifest_command: 'find . -type f | sort',
      manifest_output_sha256: 'f'.repeat(64),
      test_inventory: { source_command: 'npm test', source_exit_code: 0, source_output_sha256: 'c'.repeat(64), counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, tests: [], removed_tests: [] },
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
});

expectCode('E_TEST_INVENTORY_REQUIRED', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, VALID_PLAN_CONTENT, 'plan_works');
  const implement = createImplement(persistence, { session_id: plan.session_id, artifact_digest: planDigest });
  const files = [file('src/a.js', 'a', 'source')];
  artifactCommit({
    input: { session_id: implement.session_id, submission_id: submissionId(), expected_round: 1, files, manifest_command: 'find . -type f | sort', manifest_output_sha256: computeManifestDigest(files), change_note: CHANGE_NOTE },
    persistence,
  });
});

expectCode('E_TEST_MUTATED_WITHOUT_DIFF', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, VALID_PLAN_CONTENT, 'plan_works');
  const implement = createImplement(persistence, { session_id: plan.session_id, artifact_digest: planDigest });
  const files1 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'b', 'test')];
  const inv1 = { source_command: 'npm test', source_exit_code: 0, source_output_sha256: 'c'.repeat(64), counts: { total: 5, passed: 5, failed: 0, skipped: 0 }, tests: makeTests(5, 'test/a.test.js'), removed_tests: [] };
  commitFileset(persistence, implement.session_id, 1, files1, inv1);
  const s1 = scoreSubmit({
    input: {
      session_id: implement.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: computeManifestDigest(files1) ? `sha256:${computeManifestDigest(files1)}` : null,
      scores: [{ criterion_id: 'tests_green', score: 8, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'command', command: 'npm test', exit_code: 0, output_sha256: 'c'.repeat(64), output_excerpt: 'PASS', target_digest: `sha256:${computeManifestDigest(files1)}` }] }],
    },
    persistence,
  });
  assert.equal(s1.verdict, 'ITERATING');
  // テストファイルの sha256 を変えるが diffs を添付しない
  const files2 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'd', 'test')];
  const inv2 = { ...inv1, source_output_sha256: 'e'.repeat(64), diffs: [] };
  commitFileset(persistence, implement.session_id, 2, files2, inv2, ['tests_green']);
});

expectCode('E_TEST_REGRESSION', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, VALID_PLAN_CONTENT, 'plan_works');
  const implement = createImplement(persistence, { session_id: plan.session_id, artifact_digest: planDigest });
  const files1 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'b', 'test')];
  const inv1 = { source_command: 'npm test', source_exit_code: 0, source_output_sha256: 'c'.repeat(64), counts: { total: 10, passed: 10, failed: 0, skipped: 0 }, tests: makeTests(10, 'test/a.test.js'), removed_tests: [] };
  const c1 = commitFileset(persistence, implement.session_id, 1, files1, inv1);
  scoreSubmit({
    input: {
      session_id: implement.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [{ criterion_id: 'tests_green', score: 8, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'command', command: 'npm test', exit_code: 0, output_sha256: 'c'.repeat(64), output_excerpt: 'PASS', target_digest: c1.artifact.digest }] }],
    },
    persistence,
  });
  const files2 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'd', 'test')];
  const inv2 = {
    source_command: 'npm test', source_exit_code: 0, source_output_sha256: 'e'.repeat(64),
    counts: { total: 5, passed: 5, failed: 0, skipped: 0 }, tests: makeTests(5, 'test/a.test.js'), removed_tests: [],
    diffs: [{ file: 'test/a.test.js', command: 'git diff', output_excerpt: '-削除', output_sha256: 'f'.repeat(64) }],
  };
  commitFileset(persistence, implement.session_id, 2, files2, inv2, ['tests_green']);
});

expectCode('E_UPSTREAM_NOT_FOUND', () => {
  const persistence = durablePersistence();
  const { plan } = buildDesignPlanChain(persistence);
  const raw = readSessionRaw(persistence, plan.session_id);
  raw.upstream = { ...raw.upstream, session_id: 'sess_does_not_exist' };
  writeSessionRaw(persistence, plan.session_id, raw);
  artifactCommit({ input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, content: '# 計画本文', change_note: CHANGE_NOTE }, persistence });
});

expectCode('E_FROZEN', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildDesignPlanChain(persistence);
  const raw = readSessionRaw(persistence, design.session_id);
  raw.state = 'DRAFTING';
  writeSessionRaw(persistence, design.session_id, raw);
  artifactCommit({ input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, content: '# 計画本文', change_note: CHANGE_NOTE }, persistence });
});

expectCode('E_SUPERSEDED', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildDesignPlanChain(persistence);
  const raw = readSessionRaw(persistence, design.session_id);
  raw.current_artifact = { ...raw.current_artifact, digest: `sha256:${'f'.repeat(64)}` };
  writeSessionRaw(persistence, design.session_id, raw);
  artifactCommit({ input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, content: '# 計画本文', change_note: CHANGE_NOTE }, persistence });
});

expectCode('E_PLAN_SCHEMA', () => {
  const persistence = durablePersistence();
  const { plan } = buildDesignPlanChain(persistence);
  artifactCommit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: '{ "plan_version": 1, "invalid": true }',
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
});

expectCode('E_PLAN_INVALID', () => {
  const persistence = durablePersistence();
  const { plan } = buildDesignPlanChain(persistence);
  const invalidPlan = {
    plan_version: 1,
    summary: '依存タスク欠落テスト計画のサマリーです。40文字以上必要なので長めに記述します。',
    tasks: [
      {
        id: 'T001',
        title: 'タスク1のタイトル',
        intent: 'タスク1の意図を20文字以上で記述するための文字列です',
        depends_on: ['T999'],
        design_refs: ['#sec1'],
        changes: [{ path: 'src/a.js', kind: 'add' }],
        acceptance: ['受け入れ条件1が10文字以上'],
        verify: [{ command: 'node --test', expect_exit_code: 0 }],
      },
    ],
  };
  artifactCommit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: JSON.stringify(invalidPlan),
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
});

expectCode('E_PLAN_DESIGN_REF', () => {
  const persistence = durablePersistence();
  const { plan } = buildDesignPlanChain(persistence);
  const bogusRefPlan = {
    plan_version: 1,
    summary: '設計書にない参照を含む計画サマリーです。40文字以上必要なので長めに記述します。',
    tasks: [
      {
        id: 'T001',
        title: 'タスク1',
        intent: 'タスク1の意図を20文字以上で記述するための文字列です',
        depends_on: [],
        design_refs: ['## 99. 存在しない節名'],
        changes: [{ path: 'src/a.js', kind: 'add' }],
        acceptance: ['受け入れ条件1が10文字以上'],
        verify: [{ command: 'node --test', expect_exit_code: 0 }],
      },
    ],
  };
  artifactCommit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: JSON.stringify(bogusRefPlan),
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
});

test('artifact_commit: valid plan succeeds', () => {
  const persistence = durablePersistence();
  const { plan } = buildDesignPlanChain(persistence);
  const res = artifactCommit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: VALID_PLAN_CONTENT,
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
  assert.equal(res.ok, true);
});

test('artifact_commit: 再現したコード集合がちょうど16件で E_INTERNAL 以外の未知コードが出ない', () => {
  assert.equal(seen.size, 16);
  assert.deepEqual([...seen].sort(), [...TOOL_ERRORS.artifact_commit].sort());
  assert.ok(!seen.has('E_INTERNAL'));
});

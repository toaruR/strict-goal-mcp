// T070: score_submit のエラー17件を全数検査する（設計書 19.6.7 総覧・6.4.4）。
// 19.6.7 本文が挙げる E_TEST_REGRESSION/E_UPSTREAM_NOT_ALLOWED/E_CHAIN_BUDGET_EXHAUSTED は
// score_submit.js からは一切呼ばれておらず到達不能（CLAUDE.md ハマりポイント参照）。
// さらに E_EVIDENCE_REQUIRED は evidence/verify.js のコメントが自認するとおり
// schemas/tools.json 側の scores[].evidence が minItems:1 を強制するため、
// 公開スキーマを通す限り assertEvidenceRequired の空配列チェックに実行が到達しない
// （防御的な二重チェックであり、E_VALIDATION が必ず先に飛ぶ）。
// 代わりに実際に到達する E_SESSION_NOT_FOUND/E_UPSTREAM_NOT_FOUND を含めた、
// src/errors/codes.js の補正後レジストリ(17件)を正として検査する。
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

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-errors-score-'));
}
function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}
let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-escore-${submissionCounter}`.padEnd(8, '0');
}

const RUBRIC = {
  criteria: [
    {
      id: 'impl_works',
      statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
      weight: 1,
      verification: 'manual',
      anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
    },
    {
      id: 'docs_clear',
      statement: '文書が第三者にも明快に伝わることの根拠が十分に示されている',
      weight: 1,
      verification: 'manual',
      anchors: { 1: '不明瞭で読めない', 5: 'まあまあ読める', 9: '非常に明瞭' },
    },
  ],
};
const AUTO_RUBRIC = {
  criteria: [
    {
      id: 'tests_green',
      statement: 'テストが実際に通過していることの根拠が十分に示されている',
      weight: 1,
      verification: 'auto',
      anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
    },
  ],
};

const CONTENT_V1 = '# 設計書\n実装は一部だけ動作することを目視で確認したという記録がある。\n詳細な実行ログを見ても実装の一部動作が確認できたという記録がある。\n文書は非常に明瞭に構成されていることが読んで分かるという評価がある。';
const EXCERPT_IMPL = '実装は一部だけ動作することを目視で確認したという記録がある。';
const EXCERPT_IMPL_B = '詳細な実行ログを見ても実装の一部動作が確認できたという記録がある。';
const EXCERPT_DOCS = '文書は非常に明瞭に構成されていることが読んで分かるという評価がある。';

function createSession(persistence, overrides = {}) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: RUBRIC,
      ...overrides,
    },
    persistence,
  });
}

function commit(persistence, sessionId, content, expectedRound, addresses) {
  return artifactCommit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: expectedRound, content, change_note: CHANGE_NOTE, ...(addresses ? { addresses } : {}) },
    persistence,
  });
}

function locatorScore(criterionId, scoreValue, excerpt, overrides = {}) {
  return {
    criterion_id: criterionId,
    score: scoreValue,
    rationale: 'a'.repeat(45),
    weakness: scoreValue === 10 ? 'none' : 'b'.repeat(15),
    evidence: [{ kind: 'locator', locator: '§1', excerpt }],
    ...overrides,
  };
}
function fullScores(overrides = {}) {
  return [locatorScore('impl_works', 9, EXCERPT_IMPL, overrides.impl_works), locatorScore('docs_clear', 9, EXCERPT_DOCS, overrides.docs_clear)];
}
function commandEvidence(count) {
  return Array.from({ length: count }, (_, i) => ({ kind: 'command', command: `npm test -- --n=${i}`, exit_code: 0, output_excerpt: 'ok', output_sha256: 'a'.repeat(64) }));
}

function oneCriterionRubric(criterionId) {
  return {
    criteria: [
      { id: criterionId, statement: '実装が仕様どおりに動作することの根拠が十分に示されている', weight: 1, verification: 'manual', anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' } },
    ],
  };
}
function createDesign(persistence) {
  return loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'design', rubric: oneCriterionRubric('impl_works') },
    persistence,
  });
}
function createPlan(persistence, upstream) {
  return loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'plan', upstream, rubric: { criteria: [{ id: 'plan_works', statement: '計画が具体的で実行可能であることの根拠が十分に示されている', weight: 1, verification: 'manual', anchors: { 1: '計画が全く具体的でない', 5: '計画がある程度具体的である', 9: '計画が完全に具体的である' } }] } },
    persistence,
  });
}
const VALID_PLAN_CONTENT = JSON.stringify({
  plan_version: 1,
  summary: 'これは40文字以上になるように書いた計画の要約文章です。ダミーの文字を足して長さを稼ぎます。',
  tasks: [
    {
      id: 'T001',
      title: 'タスク1',
      intent: 'このタスクの意図を20文字以上で説明する文章',
      design_refs: ['# 設計'],
      depends_on: [],
      changes: [{ path: 'src/a.js', kind: 'add' }],
      acceptance: ['受け入れ条件が満たされること'],
      verify: [{ command: 'npm test', expect_exit_code: 0 }],
    },
  ],
}, null, 2);
const VALID_PLAN_EXCERPT = 'これは40文字以上になるように書いた計画の要約文章です。ダミーの文字を足して長さを稼ぎます。';

function finalize(persistence, sessionId, content, criterionId, excerptOverride = undefined) {
  const c1 = commit(persistence, sessionId, content, 1);
  const excerpt = excerptOverride ?? content;
  const r1 = scoreSubmit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: 1, artifact_digest: c1.artifact.digest, scores: [{ criterion_id: criterionId, score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt }] }] },
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

const seen = new Set();
function expectCode(code, fn) {
  test(`score_submit: ${code}`, () => {
    assert.throws(fn, { code });
    seen.add(code);
  });
}

expectCode('E_VALIDATION', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: fullScores({ impl_works: { rationale: 'a'.repeat(39) } }) },
    persistence,
  });
});

expectCode('E_SESSION_NOT_FOUND', () => {
  const persistence = durablePersistence();
  scoreSubmit({
    input: { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY', submission_id: submissionId(), expected_round: 1, artifact_digest: `sha256:${'a'.repeat(64)}`, scores: fullScores() },
    persistence,
  });
});

expectCode('E_STATE_VIOLATION', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: `sha256:${'a'.repeat(64)}`, scores: fullScores() },
    persistence,
  });
});

expectCode('E_CONCURRENT', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 99, artifact_digest: committed.artifact.digest, scores: fullScores() },
    persistence,
  });
});

expectCode('E_DIGEST_MISMATCH', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: `sha256:${'0'.repeat(64)}`, scores: fullScores() },
    persistence,
  });
});

expectCode('E_INCOMPLETE_SCORES', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: fullScores().filter((s) => s.criterion_id !== 'docs_clear') },
    persistence,
  });
});

expectCode('E_EVIDENCE_KIND', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, { loop_mode: 'design', rubric: AUTO_RUBRIC });
  const committed = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: [{ criterion_id: 'tests_green', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_IMPL }] }],
    },
    persistence,
  });
});

expectCode('E_EVIDENCE_NOT_FOUND', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: fullScores({ impl_works: { evidence: [{ kind: 'locator', locator: '§1', excerpt: '本文には全く存在しない架空の引用文がここにあります' }] } }) },
    persistence,
  });
});

expectCode('E_EVIDENCE_STALE', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed1.artifact.digest, scores: [locatorScore('impl_works', 5, EXCERPT_IMPL), locatorScore('docs_clear', 9, EXCERPT_DOCS)] },
    persistence,
  });
  const content2 = `${CONTENT_V1}\n追加の一文がここに入る。`;
  const committed2 = commit(persistence, created.session_id, content2, 2, ['impl_works']);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 2, artifact_digest: committed2.artifact.digest, scores: [locatorScore('impl_works', 6, EXCERPT_IMPL), locatorScore('docs_clear', 9, EXCERPT_DOCS)] },
    persistence,
  });
});

expectCode('E_EVIDENCE_TARGET', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, VALID_PLAN_CONTENT, 'plan_works', VALID_PLAN_EXCERPT);
  const implement = loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'implement', upstream: { session_id: plan.session_id, artifact_digest: planDigest }, rubric: AUTO_RUBRIC },
    persistence,
  });
  const files = [{ path: 'src/a.js', sha256: 'a'.repeat(64), bytes: 100, role: 'source' }, { path: 'test/a.test.js', sha256: 'b'.repeat(64), bytes: 100, role: 'test' }];
  const inv = { source_command: 'npm test', source_exit_code: 0, source_output_sha256: 'c'.repeat(64), counts: { total: 5, passed: 5, failed: 0, skipped: 0 }, tests: Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, file: 'test/a.test.js', status: 'passed' })), removed_tests: [] };
  const c1 = artifactCommit({
    input: { session_id: implement.session_id, submission_id: submissionId(), expected_round: 1, files, manifest_command: 'find . -type f | sort', manifest_output_sha256: computeManifestDigest(files), test_inventory: inv, change_note: CHANGE_NOTE },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: implement.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [{ criterion_id: 'tests_green', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'command', command: 'npm test', exit_code: 0, output_sha256: 'c'.repeat(64), output_excerpt: 'PASS', target_digest: `sha256:${'f'.repeat(64)}` }] }],
    },
    persistence,
  });
});

expectCode('E_SCORE_INFLATION', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed1.artifact.digest, scores: [locatorScore('impl_works', 5, EXCERPT_IMPL), locatorScore('docs_clear', 9, EXCERPT_DOCS)] },
    persistence,
  });
  const committed2 = commit(persistence, created.session_id, CONTENT_V1, 2, ['impl_works']);
  assert.equal(committed2.artifact.unchanged, true);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 2, artifact_digest: committed2.artifact.digest, scores: [locatorScore('impl_works', 6, EXCERPT_IMPL_B), locatorScore('docs_clear', 9, EXCERPT_DOCS)] },
    persistence,
  });
});

expectCode('E_SCORE_JUMP', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed1.artifact.digest, scores: [locatorScore('impl_works', 3, EXCERPT_IMPL), locatorScore('docs_clear', 9, EXCERPT_DOCS)] },
    persistence,
  });
  const content2 = `${CONTENT_V1}\n追加の一文がここに入る。`;
  const committed2 = commit(persistence, created.session_id, content2, 2, ['impl_works']);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 2, artifact_digest: committed2.artifact.digest, scores: [locatorScore('impl_works', 7, EXCERPT_IMPL, { evidence: [...commandEvidence(1)] }), locatorScore('docs_clear', 9, EXCERPT_DOCS)] },
    persistence,
  });
});

expectCode('E_WEAKNESS_REQUIRED', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed = commit(persistence, created.session_id, CONTENT_V1, 1);
  scoreSubmit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: fullScores({ impl_works: { weakness: 'none' } }) },
    persistence,
  });
});

expectCode('E_TEST_NOT_GREEN', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, VALID_PLAN_CONTENT, 'plan_works', VALID_PLAN_EXCERPT);
  const implement = loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'implement', upstream: { session_id: plan.session_id, artifact_digest: planDigest }, rubric: AUTO_RUBRIC },
    persistence,
  });
  const files = [{ path: 'src/a.js', sha256: 'a'.repeat(64), bytes: 100, role: 'source' }, { path: 'test/a.test.js', sha256: 'b'.repeat(64), bytes: 100, role: 'test' }];
  const inv = { source_command: 'npm test', source_exit_code: 1, source_output_sha256: 'c'.repeat(64), counts: { total: 5, passed: 4, failed: 1, skipped: 0 }, tests: Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, file: 'test/a.test.js', status: i === 0 ? 'failed' : 'passed' })), removed_tests: [] };
  const c1 = artifactCommit({
    input: { session_id: implement.session_id, submission_id: submissionId(), expected_round: 1, files, manifest_command: 'find . -type f | sort', manifest_output_sha256: computeManifestDigest(files), test_inventory: inv, change_note: CHANGE_NOTE },
    persistence,
  });
  scoreSubmit({
    input: {
      session_id: implement.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [{ criterion_id: 'tests_green', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'command', command: 'npm test', exit_code: 1, output_sha256: 'c'.repeat(64), output_excerpt: 'FAIL', target_digest: c1.artifact.digest }] }],
    },
    persistence,
  });
});

expectCode('E_UPSTREAM_NOT_FOUND', () => {
  const persistence = durablePersistence();
  const { plan } = buildDesignPlanChain(persistence);
  const committed = commit(persistence, plan.session_id, VALID_PLAN_CONTENT, 1);
  const raw = readSessionRaw(persistence, plan.session_id);
  raw.upstream = { ...raw.upstream, session_id: 'sess_does_not_exist' };
  writeSessionRaw(persistence, plan.session_id, raw);
  scoreSubmit({
    input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: [{ criterion_id: 'plan_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: VALID_PLAN_EXCERPT }] }] },
    persistence,
  });
});

expectCode('E_FROZEN', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildDesignPlanChain(persistence);
  const committed = commit(persistence, plan.session_id, VALID_PLAN_CONTENT, 1);
  const raw = readSessionRaw(persistence, design.session_id);
  raw.state = 'DRAFTING';
  writeSessionRaw(persistence, design.session_id, raw);
  scoreSubmit({
    input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: [{ criterion_id: 'plan_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: VALID_PLAN_EXCERPT }] }] },
    persistence,
  });
});

expectCode('E_SUPERSEDED', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildDesignPlanChain(persistence);
  const committed = commit(persistence, plan.session_id, VALID_PLAN_CONTENT, 1);
  const raw = readSessionRaw(persistence, design.session_id);
  raw.current_artifact = { ...raw.current_artifact, digest: `sha256:${'f'.repeat(64)}` };
  writeSessionRaw(persistence, design.session_id, raw);
  scoreSubmit({
    input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: [{ criterion_id: 'plan_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: VALID_PLAN_EXCERPT }] }] },
    persistence,
  });
});

expectCode('E_CHAIN_BUDGET_EXHAUSTED', () => {
  const persistence = durablePersistence();
  const { plan } = buildDesignPlanChain(persistence);
  const committed = commit(persistence, plan.session_id, VALID_PLAN_CONTENT, 1);
  const raw = readSessionRaw(persistence, plan.session_id);
  raw.round = 30;
  writeSessionRaw(persistence, plan.session_id, raw);
  scoreSubmit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: 30,
      artifact_digest: committed.artifact.digest,
      scores: [{ criterion_id: 'plan_works', score: 5, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: VALID_PLAN_EXCERPT }] }],
    },
    persistence,
  });
});

test('score_submit: 再現したコード集合がちょうど18件で E_INTERNAL 以外の未知コードが出ない', () => {
  assert.equal(seen.size, 18);
  assert.deepEqual([...seen].sort(), [...TOOL_ERRORS.score_submit].sort());
  assert.ok(!seen.has('E_INTERNAL'));
});

// T073: 失敗モード F11-F20（設計書 §2 の表）の対策が実際に効くことを検査する。
// F18 は checkDesignRefs（src/artifact/design_refs.js）が artifact_commit から未結線
// （CLAUDE.md ハマりポイント参照）のため、公開ツール artifactCommit() 経由では
// E_PLAN_DESIGN_REF に到達しない。ここでは checkDesignRefs を直接呼ぶ契約テストとして扱う
// （design_refs.test.js が既にこの関数の単体挙動を網羅しているため、ここでは F18 対応の
// 最小1件のみを確認する）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { computeManifestDigest } from '../src/artifact/fileset.js';
import { checkDesignRefs } from '../src/artifact/design_refs.js';
import { sessionDir } from '../src/store/session_store.js';
import { saveContentArtifact } from '../src/artifact/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-fm1120-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-fm1120-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const CHANGE_NOTE = 'これは20文字以上ある変更理由の説明文です';
const HUMAN_TOKEN = 'human-approval-token-placeholder';
const CONTENT = '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。';
const EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';

function oneCriterionRubric(criterionId) {
  return {
    criteria: [
      { id: criterionId, statement: '実装が仕様どおりに動作することの根拠が十分に示されている', weight: 1, verification: 'manual', anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' } },
    ],
  };
}
function planRubric(criterionId) {
  return {
    criteria: [
      { id: criterionId, statement: '計画が具体的で実行可能であることの根拠が十分に示されている', weight: 1, verification: 'manual', anchors: { 1: '計画が全く具体的でない', 5: '計画がある程度具体的である', 9: '計画が完全に具体的である' } },
    ],
  };
}
function autoRubric(criterionId) {
  return {
    criteria: [
      { id: criterionId, statement: 'テストが全て green であることの根拠が十分に示されている', weight: 1, verification: 'auto', anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' } },
    ],
  };
}

function createDesign(persistence, overrides = {}) {
  return loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'design', rubric: oneCriterionRubric('impl_works'), ...overrides },
    persistence,
  });
}
function createPlan(persistence, upstream, overrides = {}) {
  return loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'plan', upstream, rubric: planRubric('plan_works'), ...overrides },
    persistence,
  });
}
function createImplement(persistence, upstream) {
  return loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'implement', upstream, rubric: autoRubric('tests_green') },
    persistence,
  });
}

function finalizeDesign(persistence, sessionId, round = 1) {
  const content = round === 1 ? CONTENT : `${CONTENT}\n改訂第${round}版で欠陥を修正した。`;
  const c1 = artifactCommit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: round, content, change_note: CHANGE_NOTE, ...(round >= 2 ? { addresses: ['impl_works'] } : {}) },
    persistence,
  });
  const r1 = scoreSubmit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: round, artifact_digest: c1.artifact.digest, scores: [{ criterion_id: 'impl_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }] }] },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}
function finalizePlan(persistence, sessionId) {
  const content = '# 計画\n実装計画がここに詳細に記述されている一つの文章です。';
  const c1 = artifactCommit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: 1, content, change_note: CHANGE_NOTE },
    persistence,
  });
  const r1 = scoreSubmit({
    input: { session_id: sessionId, submission_id: submissionId(), expected_round: 1, artifact_digest: c1.artifact.digest, scores: [{ criterion_id: 'plan_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: content }] }] },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}
function buildFinalChain(persistence) {
  const design = createDesign(persistence);
  const designDigest = finalizeDesign(persistence, design.session_id, 1);
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
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      files,
      manifest_command: 'find . -type f | sort',
      manifest_output_sha256: computeManifestDigest(files),
      test_inventory: testInventory,
      change_note: CHANGE_NOTE,
      ...(addresses ? { addresses } : {}),
    },
    persistence,
  });
}

// --- F11: 評価の空洞化（引用が成果物に無い） ---

test('F11: 成果物本文に存在しない excerpt を根拠にすると E_EVIDENCE_NOT_FOUND になる', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const c1 = artifactCommit({
    input: { session_id: design.session_id, submission_id: submissionId(), expected_round: 1, content: CONTENT, change_note: CHANGE_NOTE },
    persistence,
  });
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: design.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: c1.artifact.digest,
          scores: [{ criterion_id: 'impl_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: '本文には全く存在しない架空の引用文がここにあります' }] }],
        },
        persistence,
      }),
    { code: 'E_EVIDENCE_NOT_FOUND' },
  );
});

// --- F12: セッションの取り違え／並行上書き ---

test('F12: expected_round が現在の round と食い違うと E_CONCURRENT になる（楽観ロック）', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  assert.throws(
    () =>
      artifactCommit({
        input: { session_id: design.session_id, submission_id: submissionId(), expected_round: 99, content: CONTENT, change_note: CHANGE_NOTE },
        persistence,
      }),
    { code: 'E_CONCURRENT' },
  );
});

// --- F13: サーバ不在で無検証の完了宣言（SKILL.md の縮退規約） ---

test('F13: SKILL.md がツール不在時に UNVERIFIED-COMPLETE への格下げとモード別の縮退要件を規約化している', () => {
  const skillPath = path.resolve(__dirname, '..', '..', 'skills', 'rubric-loop', 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');
  assert.match(skill, /UNVERIFIED-COMPLETE: rubric-loop server unavailable/);
  assert.match(skill, /FINAL を名乗らない/);
  for (const mode of ['design', 'plan', 'implement']) {
    assert.ok(skill.includes(`- ${mode} `) || skill.includes(`- ${mode} —`), `${mode} の縮退要件が明記されている`);
  }
});

// --- F14: 通信断による二重採点（submission_id 冪等） ---

test('F14: 同一 submission_id の artifact_commit 再送は round を進めず保存済み応答を返す', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const sid = submissionId();
  const first = artifactCommit({
    input: { session_id: design.session_id, submission_id: sid, expected_round: 1, content: CONTENT, change_note: CHANGE_NOTE },
    persistence,
  });
  const second = artifactCommit({
    input: { session_id: design.session_id, submission_id: sid, expected_round: 1, content: CONTENT, change_note: CHANGE_NOTE },
    persistence,
  });
  assert.deepEqual(first, second);
  assert.equal(readSessionRaw(persistence, design.session_id).state, 'SCORING');
});

// --- F15: 上流の版を知らずに下流を始める ---

test('F15: 上流無しで plan を開くと E_UPSTREAM_REQUIRED、digest 不一致は E_UPSTREAM_DIGEST_MISMATCH', () => {
  const persistence = durablePersistence();
  assert.throws(
    () =>
      loopOpenCreate({
        input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'plan', rubric: planRubric('plan_works') },
        persistence,
      }),
    { code: 'E_UPSTREAM_REQUIRED' },
  );

  const design = createDesign(persistence);
  finalizeDesign(persistence, design.session_id, 1);
  assert.throws(
    () => createPlan(persistence, { session_id: design.session_id, artifact_digest: `sha256:${'f'.repeat(64)}` }),
    { code: 'E_UPSTREAM_DIGEST_MISMATCH' },
  );
});

// --- F16: 上流が変わったのに下流が古い合格のまま残る ---

test('F16: 下流が FINAL でも上流 digest がずれれば容赦なく SUPERSEDED に落ちる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);
  finalizePlan(persistence, plan.session_id);
  assert.equal(readSessionRaw(persistence, plan.session_id).state, 'FINAL');

  const raw = readSessionRaw(persistence, design.session_id);
  raw.current_artifact = { ...raw.current_artifact, digest: `sha256:${'f'.repeat(64)}` };
  writeSessionRaw(persistence, design.session_id, raw);

  const resumed = loopOpenResume({ input: { mode: 'resume', submission_id: submissionId(), session_id: plan.session_id }, persistence });
  assert.equal(resumed.state, 'SUPERSEDED');
});

// --- F17: 上流の欠陥を下流で辻褄合わせする ---

test('F17: escalate(kickback) で下流は FROZEN になり、下流だけを進める経路が無い', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildFinalChain(persistence);
  finalizePlan(persistence, plan.session_id);

  const kicked = escalate({
    input: { session_id: plan.session_id, submission_id: submissionId(), action: 'kickback', human_token: HUMAN_TOKEN, target_criteria: ['impl_works'], note: NOTE },
    persistence,
  });
  assert.equal(kicked.state, 'FROZEN');
  assert.equal(readSessionRaw(persistence, design.session_id).state, 'DRAFTING');

  assert.throws(
    () =>
      artifactCommit({
        input: { session_id: plan.session_id, submission_id: submissionId(), expected_round: 1, content: '# 計画2', change_note: CHANGE_NOTE },
        persistence,
      }),
    (err) => err.code === 'E_FROZEN' && err.detail.upstream_session_id === design.session_id,
  );
});

// --- F18: 計画に設計外の作業を混ぜる（design_refs 照合）---
// artifact_commit からは未結線なため checkDesignRefs を直接契約テストする（本ファイル冒頭のコメント参照）。

test('F18: 上流設計書に実在しない design_refs を持つ plan は checkDesignRefs が E_PLAN_DESIGN_REF で拒否する', () => {
  const dataDir = tmpDataDir();
  const sDir = sessionDir(dataDir, 'rl_fm18_upstream');
  const { digest } = saveContentArtifact(sDir, 'markdown', '# 設計書\n\n## §1 概要\n本文です。\n');
  writeSession(dataDir, { session_id: 'rl_fm18_upstream', artifact_kind: 'markdown', state: 'FINAL', round: 1, updated_at: new Date().toISOString(), label: null, chain_id: 'ch_fm18' });

  const plan = { plan_version: 1, summary: 'x', tasks: [{ id: 'T001', design_refs: ['設計書に存在しない見出し'] }] };
  assert.throws(
    () => checkDesignRefs(dataDir, plan, { session_id: 'rl_fm18_upstream', artifact_digest: digest }),
    (err) => err.code === 'E_PLAN_DESIGN_REF' && err.detail.task_id === 'T001',
  );
});

// --- F19: テストを消す・skip する・アサートを弱めて green にする ---

test('F19: 説明なきテスト減少は E_TEST_REGRESSION、テスト改変に diff 無しは E_TEST_MUTATED_WITHOUT_DIFF、非 green の auto 満点は E_TEST_NOT_GREEN', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalizeDesign(persistence, design.session_id, 1);
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalizePlan(persistence, plan.session_id);
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

  // 説明なくテスト総数を減らす → E_TEST_REGRESSION
  const files2 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'b', 'test')];
  const inv2 = { source_command: 'npm test', source_exit_code: 0, source_output_sha256: 'd'.repeat(64), counts: { total: 5, passed: 5, failed: 0, skipped: 0 }, tests: makeTests(5, 'test/a.test.js'), removed_tests: [] };
  assert.throws(() => commitFileset(persistence, implement.session_id, 2, files2, inv2, ['tests_green']), { code: 'E_TEST_REGRESSION' });

  // テストファイルの sha256 を変えるが diffs を添付しない → E_TEST_MUTATED_WITHOUT_DIFF
  const files3 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'e', 'test')];
  const inv3 = { ...inv1, source_output_sha256: 'f'.repeat(64), diffs: [] };
  assert.throws(() => commitFileset(persistence, implement.session_id, 2, files3, inv3, ['tests_green']), { code: 'E_TEST_MUTATED_WITHOUT_DIFF' });

  // テストが green でないのに auto 基準へ満点(9)を付ける → E_TEST_NOT_GREEN
  const invRed = { source_command: 'npm test', source_exit_code: 1, source_output_sha256: '1'.repeat(64), counts: { total: 10, passed: 9, failed: 1, skipped: 0 }, tests: makeTests(10, 'test/a.test.js'), removed_tests: [] };
  const c2 = commitFileset(persistence, implement.session_id, 2, files1, invRed, ['tests_green']);
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: implement.session_id,
          submission_id: submissionId(),
          expected_round: 2,
          artifact_digest: c2.artifact.digest,
          scores: [{ criterion_id: 'tests_green', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'command', command: 'npm test', exit_code: 1, output_sha256: '1'.repeat(64), output_excerpt: 'FAIL', target_digest: c2.artifact.digest }] }],
        },
        persistence,
      }),
    { code: 'E_TEST_NOT_GREEN' },
  );
});

// --- F20: 3モード合計での暴走（チェーン予算） ---

test('F20: チェーン合計ラウンドが上限に達すると新規セッション作成が E_CHAIN_BUDGET_EXHAUSTED になる', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalizeDesign(persistence, design.session_id, 1);
  const session = readSession(persistence.dir, design.session_id);
  session.round = 28;
  writeSession(persistence.dir, session);
  assert.throws(
    () => createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest }),
    { code: 'E_CHAIN_BUDGET_EXHAUSTED' },
  );
});

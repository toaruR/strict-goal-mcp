// AT-3: ごまかし検出②：根拠の捏造と使い回し。docs/design-rubric-loop-mcp.md §13 AT-3。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at3-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at3-${submissionCounter}`.padEnd(8, '0');
}

function criterion(id, overrides = {}) {
  return {
    id,
    statement: `${id} の基準を十分に満たしていることの根拠が示されている`,
    weight: 1,
    verification: 'manual',
    anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす' },
    ...overrides,
  };
}

const RUBRIC = {
  criteria: [
    criterion('self_hosting'),
    criterion('package_conformance', { verification: 'auto' }),
    criterion('acceptance_tests'),
  ],
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      label: 'rubric-loop-at3',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: RUBRIC,
    },
    persistence,
  });
}

function commit(persistence, sessionId, expectedRound, content, addresses) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content,
      change_note: `第${expectedRound}版の改訂理由をここに20文字以上で説明する`,
      ...(addresses ? { addresses } : {}),
    },
    persistence,
  });
}

function commandEvidence(command, exitCode = 0) {
  return {
    kind: 'command',
    command,
    exit_code: exitCode,
    output_excerpt: `${command} の出力: OK`,
    output_sha256: 'a'.repeat(64),
  };
}

function locatorEvidence(excerpt) {
  return { kind: 'locator', locator: '§1', excerpt };
}

function score(persistence, sessionId, expectedRound, digest, scores) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: scores.map(({ id, value, evidence }) => ({
        criterion_id: id,
        score: value,
        rationale: 'a'.repeat(45),
        weakness: value === 10 ? 'none' : 'b'.repeat(15),
        evidence,
      })),
    },
    persistence,
  });
}

const SELF_HOSTING_EXCERPT_1 = 'セルフホスティングについては何も着手していない状態である。';
const SELF_HOSTING_EXCERPT_2 = '本設計書自身をこのループで9周かけて収束させた記録を付録に示す。';
const PACKAGE_EXCERPT = 'パッケージ構成は最低限のみで規約への準拠は途中である。';
const ACCEPTANCE_EXCERPT = '受け入れテストは3本しかなく本数が不足している。';

test('AT-3: 根拠の捏造・使い回し・種別違反・過剰ジャンプを順に検出し、正しい根拠で通る', () => {
  const persistence = durablePersistence();

  const created = createSession(persistence);
  const CONTENT_1 = `# 設計書\n${ACCEPTANCE_EXCERPT}\n${SELF_HOSTING_EXCERPT_1}\n${PACKAGE_EXCERPT}`;
  const c1 = commit(persistence, created.session_id, 1, CONTENT_1);

  const r1 = score(persistence, created.session_id, 1, c1.artifact.digest, [
    { id: 'self_hosting', value: 3, evidence: [locatorEvidence(SELF_HOSTING_EXCERPT_1)] },
    { id: 'package_conformance', value: 5, evidence: [commandEvidence('npm run lint')] },
    { id: 'acceptance_tests', value: 4, evidence: [locatorEvidence(ACCEPTANCE_EXCERPT)] },
  ]);
  assert.equal(r1.verdict, 'ITERATING');
  assert.equal(r1.must_fix[0].criterion_id, 'self_hosting');
  assert.equal(r1.round, 2);

  const CONTENT_2 = `${CONTENT_1}\n${SELF_HOSTING_EXCERPT_2}`;
  const c2 = commit(persistence, created.session_id, 2, CONTENT_2, ['self_hosting']);
  assert.equal(c2.state, 'SCORING');

  // 1. self_hosting=9 の根拠が本文に実在しない → E_EVIDENCE_NOT_FOUND
  const fabricatedExcerpt = '本設計書自身を9周かけて収束させた記録は付録Zにある';
  assert.throws(
    () =>
      score(persistence, created.session_id, 2, c2.artifact.digest, [
        { id: 'self_hosting', value: 9, evidence: [locatorEvidence(fabricatedExcerpt)] },
        { id: 'package_conformance', value: 5, evidence: [commandEvidence('npm run lint')] },
        { id: 'acceptance_tests', value: 4, evidence: [locatorEvidence(ACCEPTANCE_EXCERPT)] },
      ]),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_NOT_FOUND');
      assert.equal(err.detail.criterion_id, 'self_hosting');
      return true;
    },
  );

  // 2. self_hosting=9 の根拠が前周と完全に同一（使い回し） → E_EVIDENCE_STALE
  assert.throws(
    () =>
      score(persistence, created.session_id, 2, c2.artifact.digest, [
        { id: 'self_hosting', value: 9, evidence: [locatorEvidence(SELF_HOSTING_EXCERPT_1)] },
        { id: 'package_conformance', value: 5, evidence: [commandEvidence('npm run lint')] },
        { id: 'acceptance_tests', value: 4, evidence: [locatorEvidence(ACCEPTANCE_EXCERPT)] },
      ]),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_STALE');
      return true;
    },
  );

  // 3. package_conformance(verification:"auto") に command 根拠が無い → E_EVIDENCE_KIND
  assert.throws(
    () =>
      score(persistence, created.session_id, 2, c2.artifact.digest, [
        { id: 'self_hosting', value: 3, evidence: [locatorEvidence(SELF_HOSTING_EXCERPT_1)] },
        { id: 'package_conformance', value: 9, evidence: [locatorEvidence(PACKAGE_EXCERPT)] },
        { id: 'acceptance_tests', value: 4, evidence: [locatorEvidence(ACCEPTANCE_EXCERPT)] },
      ]),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_KIND');
      assert.equal(err.detail.criterion_id, 'package_conformance');
      return true;
    },
  );

  // 4. acceptance_tests を 4→9（delta5）に上げるが command 根拠が1件しかない → E_SCORE_JUMP
  assert.throws(
    () =>
      score(persistence, created.session_id, 2, c2.artifact.digest, [
        { id: 'self_hosting', value: 3, evidence: [locatorEvidence(SELF_HOSTING_EXCERPT_1)] },
        { id: 'package_conformance', value: 5, evidence: [commandEvidence('npm run lint')] },
        { id: 'acceptance_tests', value: 9, evidence: [commandEvidence('npm test')] },
      ]),
    (err) => {
      assert.equal(err.code, 'E_SCORE_JUMP');
      assert.equal(err.detail.criterion_id, 'acceptance_tests');
      assert.equal(err.detail.delta, 5);
      return true;
    },
  );

  // 5. 正しい根拠一式（新しい excerpt / 2件の exit_code:0 command）で通る → FINAL
  const r2 = score(persistence, created.session_id, 2, c2.artifact.digest, [
    { id: 'self_hosting', value: 9, evidence: [locatorEvidence(SELF_HOSTING_EXCERPT_2), commandEvidence('npm run self-host-check'), commandEvidence('npm run verify')] },
    { id: 'package_conformance', value: 9, evidence: [commandEvidence('npm run lint'), commandEvidence('npm run package-check')] },
    { id: 'acceptance_tests', value: 9, evidence: [commandEvidence('npm test'), commandEvidence('npm run e2e')] },
  ]);
  assert.equal(r2.ok, true);
  assert.equal(r2.verdict, 'FINAL');
  assert.equal(r2.state, 'FINAL');
});

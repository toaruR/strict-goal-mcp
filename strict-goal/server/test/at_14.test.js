// AT-14: 実装モードのごまかし検出（テスト削除）。docs/design-rubric-loop-mcp.md §13 AT-14。
// fileset は artifact_commit に結線済み(CLAUDE.mdの訂正済みハマりポイント参照)なので、
// 公開ツール経由で design→plan→implement の implement 側を直接検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { computeManifestDigest } from '../src/artifact/fileset.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at14-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at14-${submissionCounter}`.padEnd(8, '0');
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
          criterion_id: criterionId,
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: content }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}

function file(p, byte, role = 'test') {
  return { path: p, sha256: byte.repeat(64), bytes: 100, role };
}

function makeTests(n, filePath) {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, file: filePath, status: 'passed' }));
}

function scoreImplement(persistence, sessionId, expectedRound, digest, score, outputSha) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: [
        {
          criterion_id: 'tests_green',
          score,
          rationale: 'a'.repeat(45),
          weakness: score === 10 ? 'none' : 'b'.repeat(15),
          evidence: [
            {
              kind: 'command',
              command: 'npm test',
              exit_code: 0,
              output_sha256: outputSha,
              output_excerpt: `PASS all tests (round ${expectedRound})`,
              target_digest: digest,
            },
          ],
        },
      ],
    },
    persistence,
  });
}

function commitFileset(persistence, sessionId, expectedRound, files, testInventory, changeNote = 'これは20文字以上ある変更理由の説明文です', addresses = undefined) {
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
      change_note: changeNote,
      ...(addresses ? { addresses } : {}),
    },
    persistence,
  });
}

test('AT-14: 説明なしのテスト総数減少はE_TEST_REGRESSION、removed_testsで説明を添えれば受理されwarningsが残る', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, '# 計画\n実装計画がここに詳細に記述されている一つの文章です。', 'plan_works');
  const implement = createImplement(persistence, { session_id: plan.session_id, artifact_digest: planDigest });

  const files1 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'b', 'test')];
  const inventory1 = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 126, passed: 126, failed: 0, skipped: 0 },
    tests: makeTests(126, 'test/a.test.js'),
    removed_tests: [],
  };
  const c1 = commitFileset(persistence, implement.session_id, 1, files1, inventory1);
  assert.equal(c1.ok, true);
  // round1はITERATING止まりにして次のcommitに進めるためのstate遷移(DRAFTING)を作る
  const s1 = scoreImplement(persistence, implement.session_id, 1, c1.artifact.digest, 8, 'c'.repeat(64));
  assert.equal(s1.verdict, 'ITERATING');

  // round2: 説明なしに126→121へ減らす → E_TEST_REGRESSION
  const files2 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'd', 'test')];
  const inventory2Unexplained = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'e'.repeat(64),
    counts: { total: 121, passed: 121, failed: 0, skipped: 0 },
    tests: makeTests(121, 'test/a.test.js'),
    removed_tests: [],
    diffs: [
      {
        file: 'test/a.test.js',
        command: 'git diff test/a.test.js',
        output_excerpt: '-テスト122〜126を削除',
        output_sha256: 'f'.repeat(64),
      },
    ],
  };
  assert.throws(
    () => commitFileset(persistence, implement.session_id, 2, files2, inventory2Unexplained, '落ちるテストを整理した20文字以上の説明', ['tests_green']),
    (err) => {
      assert.equal(err.code, 'E_TEST_REGRESSION');
      assert.ok(err.detail.unexplained.length > 0);
      return true;
    },
  );

  // round2やり直し: removed_testsで5件の理由を添えると受理され、warningsが残る
  const removedIds = Array.from({ length: 5 }, (_, i) => `t${122 + i}`);
  const inventory2Explained = {
    ...inventory2Unexplained,
    removed_tests: removedIds.map((id) => ({ id, reason: '重複していた古いテストケースを統合したため削除した' })),
  };
  const c2 = commitFileset(persistence, implement.session_id, 2, files2, inventory2Explained, '落ちるテストを整理した20文字以上の説明', ['tests_green']);
  assert.equal(c2.ok, true);

  const s2 = scoreImplement(persistence, implement.session_id, 2, c2.artifact.digest, 9, 'd'.repeat(64));
  assert.equal(s2.verdict, 'FINAL');
});

// AT-15: 実装モードのごまかし検出（結果の使い回し・アサート弱化）。docs/design-rubric-loop-mcp.md §13 AT-15。
// (a)(b) command根拠のtarget_digest不一致・欠落はどちらも同じE_EVIDENCE_TARGET(src/evidence/verify.js)、
// (c) テストファイルのsha256変更にdiffsが無ければE_TEST_MUTATED_WITHOUT_DIFF(R5)、
// (d) test_inventoryがgreenでないのにauto基準へpass_score以上を付けるとE_TEST_NOT_GREEN(R4)になる。
// 設計書の例が挙げる個別理由文字列(例:"target_digest_required_in_implement_mode")は実装に存在せず、
// いずれもE_EVIDENCE_TARGETの{expected,actual}に集約される点に注意。
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
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at15-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at15-${submissionCounter}`.padEnd(8, '0');
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
      rubric: oneCriterionRubric('tests_green', 'auto'),
    },
    persistence,
  });
}

function finalizeDesign(persistence, sessionId, content, criterionId) {
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

function makeTests(n, filePath, status = 'passed') {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, file: filePath, status }));
}

function commitFileset(persistence, sessionId, expectedRound, files, testInventory, extra = {}) {
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
      change_note: 'これは20文字以上ある変更理由の説明文です',
      ...extra,
    },
    persistence,
  });
}

function commandEvidence({ targetDigest, outputExcerpt, outputSha = 'c'.repeat(64), exitCode = 0 }) {
  const ev = {
    kind: 'command',
    command: 'npm test',
    exit_code: exitCode,
    output_sha256: outputSha,
    output_excerpt: outputExcerpt,
  };
  if (targetDigest !== undefined) ev.target_digest = targetDigest;
  return ev;
}

function scoreAuto(persistence, sessionId, expectedRound, digest, score, evidence) {
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
          evidence: [evidence],
        },
      ],
    },
    persistence,
  });
}

test('AT-15: target_digest不一致/欠落はE_EVIDENCE_TARGET、テスト改変にdiffsが無ければE_TEST_MUTATED_WITHOUT_DIFF、非green時のauto満点はE_TEST_NOT_GREEN', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalizeDesign(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalizeDesign(persistence, plan.session_id, '# 計画\n実装計画がここに詳細に記述されている一つの文章です。', 'plan_works');
  const implement = createImplement(persistence, { session_id: plan.session_id, artifact_digest: planDigest });

  const files1 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'b', 'test')];
  const greenInventory = {
    source_command: 'npm test',
    source_exit_code: 0,
    source_output_sha256: 'c'.repeat(64),
    counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
    tests: makeTests(10, 'test/a.test.js'),
    removed_tests: [],
  };
  const c1 = commitFileset(persistence, implement.session_id, 1, files1, greenInventory);
  assert.equal(c1.ok, true);

  // (a) 他のラウンド/成果物を指すtarget_digestを使い回す → E_EVIDENCE_TARGET
  const staleDigest = `sha256:${'0'.repeat(64)}`;
  assert.throws(
    () =>
      scoreAuto(
        persistence,
        implement.session_id,
        1,
        c1.artifact.digest,
        9,
        commandEvidence({ targetDigest: staleDigest, outputExcerpt: 'PASS (stale target)' }),
      ),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_TARGET');
      assert.equal(err.detail.expected, c1.artifact.digest);
      assert.equal(err.detail.actual, staleDigest);
      return true;
    },
  );

  // (b) target_digestを省略 → 同じくE_EVIDENCE_TARGET(actualはundefined)
  assert.throws(
    () =>
      scoreAuto(
        persistence,
        implement.session_id,
        1,
        c1.artifact.digest,
        9,
        commandEvidence({ outputExcerpt: 'PASS (no target)' }),
      ),
    (err) => {
      assert.equal(err.code, 'E_EVIDENCE_TARGET');
      assert.equal(err.detail.expected, c1.artifact.digest);
      assert.equal(err.detail.actual, undefined);
      return true;
    },
  );

  // 正しいtarget_digestならITERATING(score8)で次ラウンドへ進める
  const s1 = scoreAuto(
    persistence,
    implement.session_id,
    1,
    c1.artifact.digest,
    8,
    commandEvidence({ targetDigest: c1.artifact.digest, outputExcerpt: 'PASS (round1)' }),
  );
  assert.equal(s1.verdict, 'ITERATING');

  // (c) round2: テストファイルのsha256を変えるがdiffsを付けない → E_TEST_MUTATED_WITHOUT_DIFF
  const files2 = [file('src/a.js', 'a', 'source'), file('test/a.test.js', 'd', 'test')];
  const inventory2 = {
    ...greenInventory,
    source_output_sha256: 'e'.repeat(64),
  };
  assert.throws(
    () => commitFileset(persistence, implement.session_id, 2, files2, inventory2, { addresses: ['tests_green'] }),
    (err) => {
      assert.equal(err.code, 'E_TEST_MUTATED_WITHOUT_DIFF');
      assert.deepEqual(err.detail.files, ['test/a.test.js']);
      return true;
    },
  );

  // diffsを付ければ受理される(このラウンドはテストがfailするよう仕込む)
  const failingInventory2 = {
    ...inventory2,
    source_exit_code: 1,
    counts: { total: 10, passed: 9, failed: 1, skipped: 0 },
    tests: makeTests(9, 'test/a.test.js').concat([{ id: 't10', file: 'test/a.test.js', status: 'failed' }]),
    diffs: [
      {
        file: 'test/a.test.js',
        command: 'git diff test/a.test.js',
        output_excerpt: '+アサーションを1件追加した',
        output_sha256: 'f'.repeat(64),
      },
    ],
  };
  const c2 = commitFileset(persistence, implement.session_id, 2, files2, failingInventory2, { addresses: ['tests_green'] });
  assert.equal(c2.ok, true);

  // (d) テストがgreenでないのにauto基準へpass_score(9)以上を付ける → E_TEST_NOT_GREEN
  assert.throws(
    () =>
      scoreAuto(
        persistence,
        implement.session_id,
        2,
        c2.artifact.digest,
        9,
        commandEvidence({ targetDigest: c2.artifact.digest, outputExcerpt: 'PASS (round2, but actually red)' }),
      ),
    (err) => {
      assert.equal(err.code, 'E_TEST_NOT_GREEN');
      assert.deepEqual(err.detail.criteria, ['tests_green']);
      return true;
    },
  );

  // green未満のスコア(8)なら通り、ITERATINGのまま次ラウンドに進める
  const s2 = scoreAuto(
    persistence,
    implement.session_id,
    2,
    c2.artifact.digest,
    8,
    commandEvidence({ targetDigest: c2.artifact.digest, outputExcerpt: 'PASS (round2, honest 8)' }),
  );
  assert.equal(s2.verdict, 'ITERATING');
});

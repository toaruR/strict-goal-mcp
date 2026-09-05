// AT-17: 途中モードからの再開（実装セッションのハンドル1個）。docs/design-rubric-loop-mcp.md §13 AT-17。
// 「上流が消えていた場合」の設計書の例は state:"DRAFTING", orphan:true, warnings:["upstream_missing"]
// という優雅な縮退を期待するが、実際は src/chain/supersede.js の checkSupersede が
// upstream セッションディレクトリの不在を toolName に関係なく即 E_UPSTREAM_NOT_FOUND で
// 弾く(ALWAYS_ALLOWED_TOOLSの分岐より前)。loop_state.js の buildUpstreamArtifact 内にある
// 「upstream_missingをwarningsに積んでundefinedを返す」分岐は、checkSupersedeが先に必ず
// 投げるため公開経路からは到達できない(現状デッドコード)。本テストはこの実際の挙動
// (E_UPSTREAM_NOT_FOUND)を記録する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { computeManifestDigest } from '../src/artifact/fileset.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at17-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at17-${submissionCounter}`.padEnd(8, '0');
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

test('AT-17: implementセッションのハンドル1個からloop_open(resume)で全文脈を復元でき、loop_state({include})でupstream/chain/成果物頭も取り戻せる', () => {
  const persistence = durablePersistence();
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。', 'impl_works');
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  const planDigest = finalize(persistence, plan.session_id, '# 計画\n実装計画がここに詳細に記述されている一つの文章です。', 'plan_works');
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
  const manifestDigest = computeManifestDigest(files1);
  const c1 = artifactCommit({
    input: {
      session_id: implement.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      files: files1,
      manifest_command: 'find . -type f | sort',
      manifest_output_sha256: manifestDigest,
      test_inventory: greenInventory,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  const s1 = scoreSubmit({
    input: {
      session_id: implement.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [
        {
          criterion_id: 'tests_green',
          score: 7,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'command', command: 'npm test', exit_code: 0, output_sha256: 'c'.repeat(64), output_excerpt: 'PASS', target_digest: c1.artifact.digest }],
        },
      ],
    },
    persistence,
  });
  assert.equal(s1.verdict, 'ITERATING');

  // 1. 新プロセス相当: session_idだけを持ってresumeする(rubricもupstreamも渡さない)
  const resumed = loopOpenResume({
    input: { mode: 'resume', submission_id: submissionId(), session_id: implement.session_id },
    persistence,
  });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.loop_mode, 'implement');
  assert.equal(resumed.chain_id, design.chain_id);
  assert.equal(resumed.state, 'DRAFTING');
  assert.equal(resumed.round, 2);
  assert.equal(resumed.upstream.session_id, plan.session_id);
  assert.equal(resumed.upstream.artifact_digest, planDigest);
  assert.equal(resumed.rubric.criteria[0].id, 'tests_green');
  assert.deepEqual(
    resumed.must_fix.map((m) => m.criterion_id),
    ['tests_green'],
  );

  // 2. loop_stateでupstream/chain/成果物頭を取り戻す
  const state = loopState({
    input: { session_id: implement.session_id, include: ['rubric', 'must_fix', 'upstream', 'chain', 'artifact_head'] },
    persistence,
  });
  assert.equal(state.upstream_artifact.session_id, plan.session_id);
  assert.equal(state.upstream_artifact.pinned_digest, planDigest);
  assert.equal(state.upstream_artifact.current_digest, planDigest);
  assert.equal(state.upstream_artifact.drifted, false);
  assert.equal(state.chain.links.length, 3);
  assert.deepEqual(
    state.chain.links.map((l) => l.loop_mode),
    ['design', 'plan', 'implement'],
  );
  assert.equal(state.current_artifact.digest, c1.artifact.digest);
  assert.ok(Array.isArray(state.current_artifact.files));

  // 3. 上流(plan)セッションが物理的に消えている場合:
  // 設計書はorphan:true/warnings:["upstream_missing"]という縮退を期待するが、
  // 実際はcheckSupersedeがtoolNameに関係なく即E_UPSTREAM_NOT_FOUNDで弾く。
  rmSync(path.join(persistence.dir, 'sessions', plan.session_id), { recursive: true, force: true });

  assert.throws(
    () =>
      loopOpenResume({
        input: { mode: 'resume', submission_id: submissionId(), session_id: implement.session_id },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_UPSTREAM_NOT_FOUND');
      assert.equal(err.detail.session_id, plan.session_id);
      return true;
    },
  );
  assert.throws(
    () =>
      loopState({
        input: { session_id: implement.session_id, include: ['upstream'] },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_UPSTREAM_NOT_FOUND');
      return true;
    },
  );
});

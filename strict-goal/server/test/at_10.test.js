// AT-10: 3モード連鎖の正常系。docs/design-rubric-loop-mcp.md §13 AT-10。
// 設計書の手順8はimplement作成直後・commit/score前にaudit_exportを呼ぶ流れなので、
// 本テストもそれに合わせてimplementセッションはloop_openで作成するところまでに留める
// (fileset自体はartifact_commitに結線済みで、公開ツール経由でFINALまで到達できることは別途確認済み)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { loopState } from '../src/tools/loop_state.js';
import { auditExport } from '../src/tools/audit_export.js';
import { readSession } from '../src/store/session_store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at10-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at10-${submissionCounter}`.padEnd(8, '0');
}

const DESIGN_CONTENT = '# 設計\n実装は完全に動作することを実行ログで確認したという記録がここにある。';
const PLAN_CONTENT = '# 計画\n実装計画がここに詳細に記述されている一つの文章です。';

function oneCriterionRubric(criterionId) {
  return {
    criteria: [
      {
        id: criterionId,
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
      rubric: oneCriterionRubric('impl_done'),
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

function readExportedAudit(result) {
  return JSON.parse(readFileSync(result.export.path, 'utf8'));
}

test('AT-10: design→plan→implementでchain_idが共通し、audit_export(scope:chain)にsessions3件/links2件が全てverified:trueで載る', () => {
  const persistence = durablePersistence();

  const design = createDesign(persistence);
  assert.equal(design.state, 'DRAFTING');
  assert.equal(design.round, 1);
  assert.equal(readSession(persistence.dir, design.session_id).artifact_kind, 'markdown');
  const designDigest = finalize(persistence, design.session_id, DESIGN_CONTENT, 'impl_works');

  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  assert.equal(plan.chain_id, design.chain_id);
  assert.equal(plan.loop_mode, 'plan');
  assert.equal(plan.state, 'DRAFTING');
  assert.equal(plan.upstream.verdict, 'FINAL');

  // upstream の pin と現在の digest が loop_state{include:["upstream"]} で読める
  const planState = loopState({ input: { session_id: plan.session_id, include: ['upstream'] }, persistence });
  assert.equal(planState.upstream_artifact.pinned_digest, designDigest);
  assert.equal(planState.upstream_artifact.current_digest, designDigest);
  assert.equal(planState.upstream_artifact.drifted, false);

  const planDigest = finalize(persistence, plan.session_id, PLAN_CONTENT, 'plan_works');

  const implement = createImplement(persistence, { session_id: plan.session_id, artifact_digest: planDigest });
  assert.equal(implement.chain_id, design.chain_id);
  assert.equal(readSession(persistence.dir, implement.session_id).artifact_kind, 'fileset');

  const exported = auditExport({ input: { session_id: implement.session_id, scope: 'chain' }, persistence });
  // implement は commit/score 前(=未収束)なので、chain監査の final_verdict は anchor(implement)自身の state にフォールバックする
  assert.equal(exported.export.summary.final_verdict, 'DRAFTING');
  const audit = readExportedAudit(exported);
  assert.equal(audit.chain_id, design.chain_id);
  assert.equal(audit.sessions.length, 3);
  assert.deepEqual(
    audit.sessions.map((s) => s.loop_mode),
    ['design', 'plan', 'implement'],
  );
  assert.equal(audit.links.length, 2);
  assert.ok(audit.links.every((link) => link.verified === true));
  assert.equal(audit.links[0].from, design.session_id);
  assert.equal(audit.links[0].to, plan.session_id);
  assert.equal(audit.links[0].upstream_digest, designDigest);
  assert.equal(audit.links[1].from, plan.session_id);
  assert.equal(audit.links[1].to, implement.session_id);
  assert.equal(audit.links[1].upstream_digest, planDigest);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { auditExport } from '../src/tools/audit_export.js';
import { escalate } from '../src/tools/escalate.js';
import { loopState } from '../src/tools/loop_state.js';
import { readSession } from '../src/store/session_store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-audit-chain-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-adc-${submissionCounter}`.padEnd(8, '0');
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

function finalize(persistence, sessionId, content, criterionId, evidence) {
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
          evidence: [evidence],
        },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');
  return c1.artifact.digest;
}

function buildChain(persistence) {
  const design = createDesign(persistence);
  const designDigest = finalize(persistence, design.session_id, DESIGN_CONTENT, 'impl_works', {
    kind: 'locator',
    locator: '§1',
    excerpt: DESIGN_CONTENT,
  });
  const plan = createPlan(persistence, { session_id: design.session_id, artifact_digest: designDigest });
  finalize(persistence, plan.session_id, PLAN_CONTENT, 'plan_works', {
    kind: 'locator',
    locator: '§1',
    excerpt: PLAN_CONTENT,
  });
  return { design, plan };
}

function readExportedAudit(result) {
  return JSON.parse(readFileSync(result.export.path, 'utf8'));
}

test('scope:"chain" は design→plan の2セッション分を audit_version:2 で1つにまとめる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildChain(persistence);

  const result = auditExport({ input: { session_id: plan.session_id, scope: 'chain' }, persistence });
  assert.equal(result.ok, true);
  assert.equal(result.export.schema, 'https://agent-plugins.org/x/rubric-loop/v1/audit-chain.json');
  assert.match(result.export.sha256, /^[0-9a-f]{64}$/);

  const audit = readExportedAudit(result);
  assert.equal(audit.audit_version, 2);
  assert.equal(audit.chain_id, readSession(persistence.dir, design.session_id).chain_id);

  assert.equal(audit.sessions.length, 2);
  assert.equal(audit.sessions[0].session_id, design.session_id);
  assert.equal(audit.sessions[0].loop_mode, 'design');
  assert.equal(audit.sessions[1].session_id, plan.session_id);
  assert.equal(audit.sessions[1].loop_mode, 'plan');
  assert.equal(audit.sessions[1].rounds.length, 1);
  assert.equal(audit.sessions[1].final.verdict, 'FINAL');

  assert.equal(audit.links.length, 1);
  assert.equal(audit.links[0].from, design.session_id);
  assert.equal(audit.links[0].to, plan.session_id);
  assert.equal(audit.links[0].verified, true);
  assert.equal(audit.links[0].rebased_from, null);

  assert.equal(audit.kickbacks.length, 0);
  assert.match(audit.integrity.chain_digest, /^sha256:[0-9a-f]{64}$/);

  assert.equal(result.export.summary.rounds, 2);
  assert.equal(result.export.summary.final_verdict, 'FINAL');
  assert.equal(result.export.summary.rubric_versions, 2);
  assert.equal(result.export.summary.rejected_submissions, 0);
});

test('scope:"chain" はどのメンバー session_id から呼んでも同じ chain_digest になる', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildChain(persistence);

  const fromDesign = readExportedAudit(
    auditExport({ input: { session_id: design.session_id, scope: 'chain' }, persistence }),
  );
  const fromPlan = readExportedAudit(
    auditExport({ input: { session_id: plan.session_id, scope: 'chain' }, persistence }),
  );

  assert.equal(fromDesign.integrity.chain_digest, fromPlan.integrity.chain_digest);
});

test('include_artifacts:true は chain 監査の各セッションの成果物にも content を埋め込む', () => {
  const persistence = durablePersistence();
  const { plan } = buildChain(persistence);

  const audit = readExportedAudit(
    auditExport({ input: { session_id: plan.session_id, scope: 'chain', include_artifacts: true }, persistence }),
  );
  assert.equal(audit.sessions[1].rounds[0].artifact.content, `${PLAN_CONTENT}\n`);
});

const HUMAN_TOKEN = 'human-approval-token-placeholder';
const NOTE = 'a'.repeat(45);

test('kickback と rebase の履歴が時刻付きで chain 監査に反映される', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildChain(persistence);
  const designDigestV1 = readSession(persistence.dir, design.session_id).current_artifact.digest;

  const kickedBack = escalate({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      action: 'kickback',
      human_token: HUMAN_TOKEN,
      target_criteria: ['impl_works'],
      note: NOTE,
    },
    persistence,
  });
  assert.equal(kickedBack.state, 'FROZEN');

  const c2 = artifactCommit({
    input: {
      session_id: design.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content: `${DESIGN_CONTENT}\n改訂第2版で欠陥を修正した。`,
      change_note: 'これは20文字以上ある変更理由の説明文です',
      addresses: ['impl_works'],
    },
    persistence,
  });
  const designDigestV2 = c2.artifact.digest;
  const r2 = scoreSubmit({
    input: {
      session_id: design.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      artifact_digest: designDigestV2,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: DESIGN_CONTENT }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r2.verdict, 'FINAL');

  const stateAfterSupersede = loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(stateAfterSupersede.state, 'SUPERSEDED');

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

  const c3 = artifactCommit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: rebased.round,
      content: `${PLAN_CONTENT}\n改訂版。`,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  const r3 = scoreSubmit({
    input: {
      session_id: plan.session_id,
      submission_id: submissionId(),
      expected_round: rebased.round,
      artifact_digest: c3.artifact.digest,
      scores: [
        {
          criterion_id: 'plan_works',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: PLAN_CONTENT }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r3.verdict, 'FINAL');

  const audit = readExportedAudit(
    auditExport({ input: { session_id: plan.session_id, scope: 'chain' }, persistence }),
  );

  assert.equal(audit.kickbacks.length, 1);
  assert.match(audit.kickbacks[0].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(audit.kickbacks[0].from, plan.session_id);
  assert.equal(audit.kickbacks[0].to, design.session_id);
  assert.deepEqual(audit.kickbacks[0].target_criteria, ['impl_works']);

  const planEntry = audit.sessions.find((s) => s.session_id === plan.session_id);
  assert.equal(planEntry.rebases.length, 1);
  assert.match(planEntry.rebases[0].at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(planEntry.rebases[0].from_digest, designDigestV1);
  assert.equal(planEntry.rebases[0].to_digest, designDigestV2);

  assert.equal(audit.links[0].upstream_digest, designDigestV2);
  assert.equal(audit.links[0].rebased_from, designDigestV1);
  assert.equal(audit.links[0].verified, true);

  assert.equal(audit.policy.chain_rounds_used, 3);
  assert.equal(audit.policy.chain_rounds_consumption_rate, 3 / audit.policy.chain_max_rounds);
});

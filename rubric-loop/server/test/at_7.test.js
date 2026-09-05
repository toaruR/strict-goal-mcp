// AT-7: rubric の緩和を検出してエスカレーション。docs/design-rubric-loop-mcp.md §13 AT-7。
// escalate.js の resolution 名は "approve_relaxation" ではなく "relax_rubric"、
// 遷移先も DRAFTING ではなく SCORING（escalate_core.test.js で確定済みの実装挙動）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { escalate } from '../src/tools/escalate.js';
import { auditExport } from '../src/tools/audit_export.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at7-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at7-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'a'.repeat(45);
const AMEND_REASON = 'self-hosting は本設計の範囲では過剰なので外すという理由文を40文字以上にする';

const CRITERION_SELF_HOSTING = {
  id: 'self_hosting',
  statement: 'セルフホスティングの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす' },
};
const CRITERION_CLARITY = {
  id: 'clarity',
  statement: '文書が第三者にも明快に伝わることの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '不明瞭で読めない', 5: 'まあまあ読める', 9: '非常に明瞭' },
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      label: 'rubric-loop-at7',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION_SELF_HOSTING, CRITERION_CLARITY] },
    },
    persistence,
  });
}

const EXCERPT_1 = 'セルフホスティングと文書の明快さはともに道半ばである。';
const CONTENT_1 = `# 設計書\n${EXCERPT_1}`;
const EXCERPT_2 = '文書は第三者にも十分に明快であることを新たに確認した。';
const CONTENT_2 = `${CONTENT_1}\n${EXCERPT_2}`;

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

function score(persistence, sessionId, expectedRound, digest, scores, excerpt) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: scores.map(({ id, value }) => ({
        criterion_id: id,
        score: value,
        rationale: 'a'.repeat(45),
        weakness: value === 10 ? 'none' : 'b'.repeat(15),
        evidence: [{ kind: 'locator', locator: '§1', excerpt }],
      })),
    },
    persistence,
  });
}

function readEscalationToken(persistence, sessionId, escalationId) {
  const tokenFile = path.join(persistence.dir, 'sessions', sessionId, 'escalations', `${escalationId}.token`);
  return readFileSync(tokenFile, 'utf8').trim();
}

test('AT-7: self_hosting削除の緩和がESCALATEDで止まり、relax_rubric承認後にFINAL_WITH_RELAXATIONへ収束し監査に緩和の事実が残る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  const c1 = commit(persistence, created.session_id, 1, CONTENT_1);
  const r1 = score(
    persistence,
    created.session_id,
    1,
    c1.artifact.digest,
    [
      { id: 'self_hosting', value: 6 },
      { id: 'clarity', value: 6 },
    ],
    EXCERPT_1,
  );
  assert.equal(r1.verdict, 'ITERATING');
  assert.equal(r1.round, 2);

  // 1. self_hosting を削除する変更を acknowledge_relaxation なしで送る → E_RELAXATION_UNACKNOWLEDGED
  assert.throws(
    () =>
      rubricAmend({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 2,
          criteria: [CRITERION_CLARITY],
          reason: AMEND_REASON,
        },
        persistence,
      }),
    (err) => {
      assert.equal(err.code, 'E_RELAXATION_UNACKNOWLEDGED');
      assert.equal(err.detail.classification, 'relaxation');
      return true;
    },
  );

  // 2. acknowledge_relaxation:true を付けると受理される
  const amended = rubricAmend({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      criteria: [CRITERION_CLARITY],
      reason: AMEND_REASON,
      acknowledge_relaxation: true,
    },
    persistence,
  });
  assert.equal(amended.ok, true);
  assert.equal(amended.rubric_version, 2);
  assert.equal(amended.classification, 'relaxation');
  assert.equal(amended.relaxation_count, 1);
  assert.equal(amended.final_reachable, false);

  // 3. criteria に policy を含めて送ると additionalProperties:false で E_VALIDATION
  assert.throws(
    () =>
      rubricAmend({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 2,
          criteria: [CRITERION_CLARITY],
          reason: AMEND_REASON,
          acknowledge_relaxation: true,
          policy: { pass_score: 5 },
        },
        persistence,
      }),
    { code: 'E_VALIDATION' },
  );

  // 4. 残った基準を9以上にしても relaxation 未承認のため FINAL にならず ESCALATED で止まる
  const c2 = commit(persistence, created.session_id, 2, CONTENT_2, ['self_hosting', 'clarity']);
  const r2 = score(persistence, created.session_id, 2, c2.artifact.digest, [{ id: 'clarity', value: 9 }], EXCERPT_2);
  assert.equal(r2.verdict, 'ESCALATED');
  assert.equal(r2.verdict_reason, 'relaxation_pending_approval');
  assert.equal(r2.state, 'ESCALATED');

  const escDir = path.join(persistence.dir, 'sessions', created.session_id, 'escalations');
  const escFile = readdirSync(escDir).find((name) => name.endsWith('.json'));
  const escalationId = escFile.replace('.json', '');
  const realToken = readEscalationToken(persistence, created.session_id, escalationId);

  // 5. escalate(resolve, relax_rubric) → state:SCORING、緩和が承認される
  const resolved = escalate({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      action: 'resolve',
      resolution: 'relax_rubric',
      human_token: realToken,
      note: NOTE,
    },
    persistence,
  });
  assert.equal(resolved.state, 'SCORING');

  // 6. 同じ digest・同じ点で再提出すると FINAL_WITH_RELAXATION になる
  const r3 = score(persistence, created.session_id, 2, c2.artifact.digest, [{ id: 'clarity', value: 9 }], EXCERPT_2);
  assert.equal(r3.verdict, 'FINAL_WITH_RELAXATION');
  assert.equal(r3.state, 'FINAL_WITH_RELAXATION');

  // 7. audit_export に緩和の事実が残る
  const exported = auditExport({ input: { session_id: created.session_id }, persistence });
  assert.equal(exported.export.summary.relaxations, 1);
  const audit = JSON.parse(readFileSync(exported.export.path, 'utf8'));
  assert.equal(audit.rubric_versions[1].classification, 'relaxation');
  assert.equal(audit.rubric_versions[1].reason, AMEND_REASON);
});

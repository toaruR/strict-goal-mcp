import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { auditExport } from '../src/tools/audit_export.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-audit-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-adt-${submissionCounter}`.padEnd(8, '0');
}

const CONTENT = '# 設計書\n実装は完全に動作することを実行ログで確認したという記録がある。';
const EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';
const AMEND_REASON = 'これは40文字以上ある改訂理由の説明文であり基準を追加して十分に説明を尽くしている文章です';

function oneCriterionRubric() {
  return {
    criteria: [
      {
        id: 'impl_works',
        statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
        weight: 1,
        verification: 'manual',
        anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
      },
    ],
    policy: {},
  };
}

function twoCriteria() {
  return [
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
  ];
}

function buildFinalSession(persistence) {
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: oneCriterionRubric(),
    },
    persistence,
  });

  rubricAmend({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      criteria: twoCriteria(),
      reason: AMEND_REASON,
    },
    persistence,
  });

  const c1 = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: CONTENT,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: `sha256:${'0'.repeat(64)}`,
          scores: [
            { criterion_id: 'impl_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }] },
            { criterion_id: 'docs_clear', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }] },
          ],
        },
        persistence,
      }),
    { code: 'E_DIGEST_MISMATCH' },
  );

  const r1 = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [
        { criterion_id: 'impl_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }] },
        { criterion_id: 'docs_clear', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }] },
      ],
    },
    persistence,
  });
  assert.equal(r1.verdict, 'FINAL');

  return { created, digest: c1.artifact.digest };
}

function readExportedAudit(result) {
  return JSON.parse(readFileSync(result.export.path, 'utf8'));
}

test('既定引数の audit_export が動き、監査 JSON version 1 に全周・拒否提出・rubric全版が含まれる', () => {
  const persistence = durablePersistence();
  const { created, digest } = buildFinalSession(persistence);

  const result = auditExport({ input: { session_id: created.session_id }, persistence });

  assert.equal(result.ok, true);
  assert.equal(result.export.schema, 'urn:strict-goal:schema:audit:v1');
  assert.match(result.export.sha256, /^[0-9a-f]{64}$/);
  assert.match(path.basename(result.export.path), /^audit-\d{8}T\d{6}Z\.json$/);
  assert.ok(existsSync(result.export.path));

  const audit = readExportedAudit(result);
  assert.equal(audit.audit_version, 1);

  assert.equal(audit.rubric_versions.length, 2);
  assert.equal(audit.rubric_versions[1].classification, 'addition');
  assert.equal(audit.rubric_versions[1].reason, AMEND_REASON);
  assert.deepEqual(audit.rubric_versions[1].diff.added, ['docs_clear']);

  assert.equal(audit.rounds.length, 1);
  assert.equal(audit.rounds[0].artifact.digest, digest);
  assert.equal(audit.rounds[0].evaluation.verdict, 'FINAL');
  for (const score of audit.rounds[0].submission.scores) {
    for (const ev of score.evidence) {
      assert.match(ev.evidence_digest, /^sha256:[0-9a-f]{64}$/);
    }
  }

  assert.equal(audit.rejected_submissions.length, 1);
  assert.equal(audit.rejected_submissions[0].error_code, 'E_DIGEST_MISMATCH');

  assert.equal(result.export.summary.rounds, 1);
  assert.equal(result.export.summary.final_verdict, 'FINAL');
  assert.equal(result.export.summary.rubric_versions, 2);
  assert.equal(result.export.summary.rejected_submissions, 1);
});

test('include_artifacts:false は path のみ、true は content を埋め込む', () => {
  const persistence = durablePersistence();
  const { created } = buildFinalSession(persistence);

  const withoutContent = readExportedAudit(auditExport({ input: { session_id: created.session_id }, persistence }));
  assert.ok(withoutContent.rounds[0].artifact.path);
  assert.equal(withoutContent.rounds[0].artifact.content, undefined);

  const withContent = readExportedAudit(
    auditExport({ input: { session_id: created.session_id, include_artifacts: true }, persistence }),
  );
  assert.equal(withContent.rounds[0].artifact.content, `${CONTENT}\n`);
});

test('include_diffs:false は rubric の diff と成果物の diff を省く', () => {
  const persistence = durablePersistence();
  const { created } = buildFinalSession(persistence);

  const audit = readExportedAudit(
    auditExport({ input: { session_id: created.session_id, include_diffs: false }, persistence }),
  );
  assert.equal(audit.rubric_versions[1].diff, undefined);
});

test('include_rejected:false は rejected_submissions を空にする', () => {
  const persistence = durablePersistence();
  const { created } = buildFinalSession(persistence);

  const audit = readExportedAudit(
    auditExport({ input: { session_id: created.session_id, include_rejected: false }, persistence }),
  );
  assert.deepEqual(audit.rejected_submissions, []);
});

test('存在しない session_id は E_SESSION_NOT_FOUND になる', () => {
  const persistence = durablePersistence();
  assert.throws(
    () => auditExport({ input: { session_id: 'rl_00000000000000000000000000' }, persistence }),
    { code: 'E_SESSION_NOT_FOUND' },
  );
});

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
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-audit-s-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-aud-${submissionCounter}`.padEnd(8, '0');
}

const CONTENT = '# 文書\n実装は完全に動作することを実行ログで確認したという記録がある。';
const EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';

const CRITERION_A = {
  id: 'impl_works',
  statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
  weight: 2,
  verification: 'manual',
  anchors: { 1: '全く動かない', 5: '一部だけ動く', 9: '完全に動作する' },
};
const CRITERION_B = {
  id: 'docs_clear',
  statement: '文書が第三者にも明快に伝わることの根拠が十分に示されている',
  weight: 1,
  verification: 'manual',
  anchors: { 1: '不明瞭で読めない', 5: 'まあまあ読める', 9: '非常に明瞭' },
};

test('audit_export の既定値で version 1 の監査 JSON が生成され、拒否された提出や rubric 版、digest が含まれる', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: { criteria: [CRITERION_A, CRITERION_B] },
    },
    persistence,
  });

  // 1周目のコミット
  const committed = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: CONTENT,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });

  // 不正な採点で拒否履歴を作る (E_DIGEST_MISMATCH)
  assert.throws(() =>
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
  );

  // 正常な採点
  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: [
        { criterion_id: 'impl_works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }] },
        { criterion_id: 'docs_clear', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }] },
      ],
    },
    persistence,
  });

  // 既定引数で audit_export
  const exportResult = auditExport({
    input: { session_id: created.session_id },
    persistence,
  });

  assert.equal(exportResult.ok, true);
  assert.ok(exportResult.export.path);
  assert.ok(existsSync(exportResult.export.path));
  assert.match(path.basename(exportResult.export.path), /^audit-\d{8}T\d{6}Z\.json$/);

  const auditJson = JSON.parse(readFileSync(exportResult.export.path, 'utf8'));
  assert.equal(auditJson.version, 1);
  assert.equal(auditJson.schema, 'https://agent-plugins.org/x/rubric-loop/v1/audit.json');
  assert.equal(auditJson.session.session_id, created.session_id);

  // 拒否された提出が error_code 付きで含まれる
  assert.ok(auditJson.rejected_submissions.length > 0);
  assert.equal(auditJson.rejected_submissions[0].error_code, 'E_DIGEST_MISMATCH');

  // rubric 版が含まれる
  assert.ok(auditJson.rubric_versions.length >= 1);
  assert.ok(auditJson.rubric_versions[0].digest);

  // rounds の提出と evidence_digest, artifact_digest が含まれる
  assert.ok(auditJson.rounds.length >= 1);
  assert.equal(auditJson.rounds[0].artifact_digest, committed.artifact.digest);
  assert.ok(auditJson.rounds[0].submission.scores[0].evidence_digests.length > 0);
});

test('存在しない session_id で E_SESSION_NOT_FOUND になる', () => {
  const persistence = durablePersistence();
  assert.throws(
    () =>
      auditExport({
        input: { session_id: 'rl_01J00000000000000000000000' },
        persistence,
      }),
    { code: 'E_SESSION_NOT_FOUND' },
  );
});

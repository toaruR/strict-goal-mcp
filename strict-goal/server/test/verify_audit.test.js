import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { auditExport } from '../src/tools/audit_export.js';
import { verifyAudit } from '../verify_audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verifyScript = path.resolve(__dirname, '..', 'verify_audit.js');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-audit-v-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-va-${submissionCounter}`.padEnd(8, '0');
}

const CONTENT = '# 文書\n実装は完全に動作することを実行ログで確認したという記録がある。';
const EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';

const RUBRIC = {
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

function setupValidAudit(persistence) {
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: RUBRIC,
    },
    persistence,
  });

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

  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
        },
      ],
    },
    persistence,
  });

  const exportResult = auditExport({
    input: { session_id: created.session_id, include_artifacts: false },
    persistence,
  });

  return exportResult.export.path;
}

test('正しい監査 JSON に対して verify_audit.js が終了コード 0 を返す', () => {
  const persistence = durablePersistence();
  const auditPath = setupValidAudit(persistence);

  const proc = spawnSync(process.execPath, [verifyScript, auditPath], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

test('スコアを1点だけ書き換えた監査 JSON に対して終了コード 1 を返し、不一致箇所を出力する', () => {
  const persistence = durablePersistence();
  const auditPath = setupValidAudit(persistence);

  // 監査 JSON のスコアを 9 -> 8 に改竄 (weighted_mean 9 との整合を壊す)
  const auditData = JSON.parse(readFileSync(auditPath, 'utf8'));
  auditData.rounds[0].submission.scores[0].score = 8;
  const tamperedPath = path.join(path.dirname(auditPath), 'tampered-audit.json');
  writeFileSync(tamperedPath, JSON.stringify(auditData, null, 2));

  const proc = spawnSync(process.execPath, [verifyScript, tamperedPath], { encoding: 'utf8' });
  assert.equal(proc.status, 1);
  assert.ok(proc.stderr.includes('weighted_mean mismatch') || proc.stderr.includes('min_score mismatch'));
});

test('artifact 本文を含まない監査（include_artifacts:false）でも検証できる', () => {
  const persistence = durablePersistence();
  const auditPath = setupValidAudit(persistence);
  const auditData = JSON.parse(readFileSync(auditPath, 'utf8'));

  assert.equal(auditData.rounds[0].artifact_content, undefined);
  const result = verifyAudit(auditData);
  assert.equal(result.ok, true);
});

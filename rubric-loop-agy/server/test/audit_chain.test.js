import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { auditExport } from '../src/tools/audit_export.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-audit-c-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-chain-aud-${submissionCounter}`.padEnd(8, '0');
}

const CONTENT = '# 概要\n実装は完全に動作することを実行ログで確認したという記録がある。';
const EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';

const PLAN_JSON = JSON.stringify({
  plan_version: 1,
  summary: 'これは40文字以上ある実装計画の要約文です。依存関係と受け入れ条件を完全に定義しています。',
  tasks: [
    {
      id: 'T001',
      title: '初期セットアップ',
      intent: '初期セットアップを完了する。20文字以上の説明。',
      design_refs: ['# 概要'],
      depends_on: [],
      changes: [{ path: 'src/setup.js', kind: 'add' }],
      acceptance: ['セットアップが完全に完了すること'],
      verify: [{ command: 'node test', expect_exit_code: 0 }],
    },
  ],
});

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

function commitAndFinalize(persistence, sessionId, content, isPlan = false) {
  const c = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      content,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
  const r = scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c.artifact.digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 9,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: isPlan ? '初期セットアップを完了する。20文字以上の説明。' : EXCERPT }],
        },
      ],
    },
    persistence,
  });
  assert.equal(r.verdict, 'FINAL');
  return c.artifact.digest;
}

test('scope: "chain" で version 2 の監査 JSON が生成され、全セッションが design->plan の順に並び、リンクと予算が含まれる', () => {
  const persistence = durablePersistence();

  // 1. design session
  const design = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: oneCriterionRubric(),
    },
    persistence,
  });
  const designDigest = commitAndFinalize(persistence, design.session_id, CONTENT, false);

  // 2. plan session linked to design
  const plan = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'plan',
      upstream: { session_id: design.session_id, artifact_digest: designDigest },
      rubric: oneCriterionRubric(),
    },
    persistence,
  });
  const planDigest = commitAndFinalize(persistence, plan.session_id, PLAN_JSON, true);

  // Export chain audit
  const exportResult = auditExport({
    input: {
      session_id: plan.session_id,
      scope: 'chain',
    },
    persistence,
  });

  assert.equal(exportResult.ok, true);
  assert.ok(exportResult.export.path);
  assert.ok(existsSync(exportResult.export.path));

  const chainAudit = JSON.parse(readFileSync(exportResult.export.path, 'utf8'));
  assert.equal(chainAudit.version, 2);
  assert.equal(chainAudit.audit_version, 2);
  assert.equal(chainAudit.chain_id, design.chain_id);

  // 全セッションが loop_mode の順 (design -> plan)
  assert.equal(chainAudit.sessions.length, 2);
  assert.equal(chainAudit.sessions[0].loop_mode, 'design');
  assert.equal(chainAudit.sessions[1].loop_mode, 'plan');

  // links に upstream ピンが含まれる
  assert.equal(chainAudit.links.length, 1);
  assert.equal(chainAudit.links[0].from, design.session_id);
  assert.equal(chainAudit.links[0].to, plan.session_id);
  assert.equal(chainAudit.links[0].upstream_digest, designDigest);
  assert.equal(chainAudit.links[0].verified, true);

  // 予算と消費率が含まれる
  assert.ok(chainAudit.policy.chain_max_rounds > 0);
  assert.ok(chainAudit.policy.total_rounds >= 2);
  assert.ok(chainAudit.policy.consumption_rate > 0);

  // integrity
  assert.equal(chainAudit.integrity.hash_algorithm, 'sha256');
  assert.ok(chainAudit.integrity.chain_digest.startsWith('sha256:'));
});

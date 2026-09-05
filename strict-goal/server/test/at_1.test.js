// AT-1: 正常収束（design モード単体）。docs/design-rubric-loop-mcp.md §13 AT-1。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { auditExport } from '../src/tools/audit_export.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-at1-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'RUBRIC_LOOP_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-at1-${submissionCounter}`.padEnd(8, '0');
}

function criterion(id, overrides = {}) {
  return {
    id,
    statement: `${id} の基準を十分に満たしていることの根拠が示されている`,
    weight: 1,
    verification: 'manual',
    anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす' },
    ...overrides,
  };
}

const RUBRIC = {
  criteria: [criterion('acceptance_tests'), criterion('self_hosting')],
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      label: 'rubric-loop-at1',
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: RUBRIC,
    },
    persistence,
  });
}

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

function commandEvidence(command) {
  return {
    kind: 'command',
    command,
    exit_code: 0,
    output_excerpt: `${command} の出力: OK`,
    output_sha256: 'a'.repeat(64),
  };
}

// max_score_jump(既定3) を超える点上げは exit_code:0 の command 根拠2件が無いと
// E_SCORE_JUMP になるため、大きく点を上げる周だけ bigJump:true でその2件を足す。
function score(persistence, sessionId, expectedRound, digest, scores) {
  return scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      artifact_digest: digest,
      scores: scores.map(({ id, value, excerpt, bigJump }) => ({
        criterion_id: id,
        score: value,
        rationale: 'a'.repeat(45),
        weakness: value === 10 ? 'none' : 'b'.repeat(15),
        evidence: [
          { kind: 'locator', locator: '§1', excerpt },
          ...(bigJump ? [commandEvidence('npm test -- --grep self_hosting'), commandEvidence('npm run verify')] : []),
        ],
      })),
    },
    persistence,
  });
}

test('AT-1: 3周かけて must_fix を順に潰し FINAL に達し、以後の commit は拒否され audit_export が要約を返す', () => {
  const persistence = durablePersistence();

  // 1. loop_open{mode:"create", ...}
  const created = createSession(persistence);
  assert.equal(created.ok, true);
  assert.equal(created.state, 'DRAFTING');
  assert.equal(created.round, 1);
  assert.equal(created.rubric_version, 1);
  assert.ok(created.next_action.tool);

  // 2. artifact_commit(round1)
  const CONTENT_1 = '# 設計書\n受け入れテストは3本しかなく本数が不足している。\nセルフホスティングについては何も着手していない状態である。';
  const c1 = commit(persistence, created.session_id, 1, CONTENT_1);
  assert.equal(c1.state, 'SCORING');
  assert.equal(c1.artifact.unchanged, false);

  // 3. score_submit(round1): 両基準とも最低点 → ITERATING、must_fix[0] は最低点の基準
  const r1 = score(persistence, created.session_id, 1, c1.artifact.digest, [
    { id: 'acceptance_tests', value: 5, excerpt: '受け入れテストは3本しかなく本数が不足している。' },
    { id: 'self_hosting', value: 3, excerpt: 'セルフホスティングについては何も着手していない状態である。' },
  ]);
  assert.equal(r1.verdict, 'ITERATING');
  assert.equal(r1.verdict_reason, 'below_pass_score');
  assert.equal(r1.evaluation.min_score, 3);
  assert.equal(r1.must_fix[0].criterion_id, 'self_hosting');
  assert.equal(r1.round, 2);
  assert.equal(r1.state, 'DRAFTING');

  // 4. artifact_commit(round2, addresses:[self_hosting])
  const CONTENT_2 = `${CONTENT_1}\nセルフホスティングは本ツール自身をこのループで9周かけて収束させた実例で示す。`;
  const c2 = commit(persistence, created.session_id, 2, CONTENT_2, ['self_hosting']);
  assert.equal(c2.state, 'SCORING');
  assert.equal(c2.artifact.unchanged, false);
  assert.ok(c2.artifact.diff.added_lines > 0);

  // 5. score_submit(round2): self_hosting 改善、acceptance_tests がまだ低い
  const r2 = score(persistence, created.session_id, 2, c2.artifact.digest, [
    { id: 'acceptance_tests', value: 5, excerpt: '受け入れテストは3本しかなく本数が不足している。' },
    { id: 'self_hosting', value: 8, excerpt: '本ツール自身をこのループで9周かけて収束させた実例で示す。', bigJump: true },
  ]);
  assert.equal(r2.verdict, 'ITERATING');
  assert.equal(r2.must_fix[0].criterion_id, 'acceptance_tests');
  assert.equal(r2.round, 3);

  // 6. artifact_commit(round3) → score_submit(round3, 全9以上) → FINAL
  const CONTENT_3 = `${CONTENT_2}\n受け入れテストを9本に拡張し全数を明記した。`;
  const c3 = commit(persistence, created.session_id, 3, CONTENT_3, ['acceptance_tests']);
  const r3 = score(persistence, created.session_id, 3, c3.artifact.digest, [
    { id: 'acceptance_tests', value: 9, excerpt: '受け入れテストを9本に拡張し全数を明記した。', bigJump: true },
    { id: 'self_hosting', value: 9, excerpt: '本ツール自身をこのループで9周かけて収束させた実例で示す。' },
  ]);
  assert.equal(r3.verdict, 'FINAL');
  assert.equal(r3.verdict_reason, 'all_criteria_passed');
  assert.equal(r3.state, 'FINAL');
  assert.equal(r3.evaluation.weighted_mean, 9);
  assert.equal(r3.next_action.tool, 'audit_export');

  // 7. FINAL 後の追記は E_STATE_VIOLATION
  assert.throws(
    () => commit(persistence, created.session_id, 3, CONTENT_3),
    (err) => err.code === 'E_STATE_VIOLATION' && err.detail.expected_tools.includes('audit_export'),
  );

  // 8. audit_export
  const exported = auditExport({ input: { session_id: created.session_id }, persistence });
  assert.equal(exported.ok, true);
  assert.ok(exported.export.path);
  assert.equal(exported.export.summary.final_verdict, 'FINAL');
  assert.equal(exported.export.summary.rejected_submissions, 0);
});

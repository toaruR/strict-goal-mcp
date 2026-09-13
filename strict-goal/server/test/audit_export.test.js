import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { auditExport } from '../src/tools/audit_export.js';
import { loopState } from '../src/tools/loop_state.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-audit-export-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-ae-${submissionCounter}`.padEnd(8, '0');
}

const CONTENT = '# 設計書\nインターフェースは外部公開API仕様やエラー条件まで完全に定義されている。\n十分な長さの本文が記録されている。';
const EXCERPT = 'インターフェースは外部公開API仕様やエラー条件まで完全に定義されている。';

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
  policy: {
    pass_score: 9,
    pass_weighted_mean: 9.0,
    max_rounds: 12,
    min_rounds: 2,
    stall_window: 3,
    stall_epsilon: 0.25,
    max_score_jump: 3,
  },
};

test('audit_export: session_v1.json に policy.min_rounds および evaluation.enforced_iteration が出力されること', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'Antigravity等におけるRound 1即時終了根絶の検証タスク',
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
      change_note: 'これは20文字以上の初版変更理由の説明文です',
    },
    persistence,
  });

  const scored = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: [
        {
          criterion_id: 'impl_works',
          score: 9,
          rationale: 'インターフェースが完全に定義されており外部公開API仕様も漏れなく記述されている。',
          weakness: 'ドキュメントの内部エラーコード一覧の記載が一部簡潔にとどまる',
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
        },
      ],
    },
    persistence,
  });

  assert.equal(scored.verdict, 'ITERATING');

  const exported = auditExport({
    input: { session_id: created.session_id },
    persistence,
  });
  assert.equal(exported.ok, true);

  const exportsDir = path.join(persistence.dir, 'sessions', created.session_id, 'exports');
  const files = readdirSync(exportsDir);
  assert.ok(files.length >= 1);
  const auditJson = JSON.parse(readFileSync(path.join(exportsDir, files[0]), 'utf8'));

  assert.equal(auditJson.session.policy.min_rounds, 2);
  assert.equal(auditJson.rounds[0].evaluation.enforced_iteration, true);
});

test('loop_state: projection "skill_state" で canonical_state に counters と policy が反映されること', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'Antigravity等におけるRound 1即時終了根絶の検証タスク',
      loop_mode: 'design',
      rubric: RUBRIC,
    },
    persistence,
  });

  const stateRes = loopState({
    input: { session_id: created.session_id, projection: 'skill_state' },
    persistence,
  });

  assert.equal(stateRes.ok, true);
  assert.ok(stateRes.skill_state);
  assert.ok(stateRes.skill_state.canonical_state.counters);
  assert.equal(stateRes.skill_state.canonical_state.counters.min_rounds_enforced_count, 0);
  assert.ok(stateRes.skill_state.canonical_state.policy);
  assert.equal(stateRes.skill_state.canonical_state.policy.min_rounds, 2);
});

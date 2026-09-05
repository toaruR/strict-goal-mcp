import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { exportDashboard } from '../src/dashboard/export.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-dashboard-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-dash-${submissionCounter}`.padEnd(8, '0');
}

const NOTE = 'これは20文字以上ある変更理由の説明文です';
const CONTENT = '# 文書\n実装は完全に動作することを実行ログで確認したという記録がある。';
const EXCERPT = '実装は完全に動作することを実行ログで確認したという記録がある。';

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
  };
}

function dashboardDir(persistence) {
  return path.join(persistence.dir, 'dashboard');
}

test('loop_open だけで dashboard/index.html と dashboard/<session_id>.html が生成される', () => {
  const persistence = durablePersistence();
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

  assert.ok(existsSync(path.join(dashboardDir(persistence), 'index.html')));
  assert.ok(existsSync(path.join(dashboardDir(persistence), `${created.session_id}.html`)));
});

test('score_submit 後、session html に score/weakness/verdict/next_action が反映される', () => {
  const persistence = durablePersistence();
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

  const committed = artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: CONTENT, change_note: NOTE },
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
          score: 5,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT }],
        },
      ],
    },
    persistence,
  });
  assert.equal(scored.verdict, 'ITERATING');

  const html = readFileSync(path.join(dashboardDir(persistence), `${created.session_id}.html`), 'utf8');
  assert.match(html, /verdict=ITERATING/);
  assert.match(html, /<td>5<\/td>/);
  assert.match(html, /bbbbbbbbbbbbbbb/);
  assert.match(html, /artifact_commit/);

  const indexHtml = readFileSync(path.join(dashboardDir(persistence), 'index.html'), 'utf8');
  assert.match(indexHtml, new RegExp(created.session_id));
});

test('exportDashboard は失敗しても例外を投げない（ダッシュボードは可視化用の派生物であり本体を巻き込まない）', () => {
  const persistence = durablePersistence();
  assert.doesNotThrow(() => exportDashboard(persistence.dir, 'rl_00000000000000000000000000'));
});

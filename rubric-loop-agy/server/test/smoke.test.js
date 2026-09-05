import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { escalate } from '../src/tools/escalate.js';
import { auditExport } from '../src/tools/audit_export.js';
import { handleToolsList } from '../src/mcp/tools_list.js';

// T076: パッケージ骨格と7ツールの疎通のみを見る最小スモークテスト

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-smoke-'));
}

function durablePersistence(dir = tmpDataDir()) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCount = 0;
function nextSubId() {
  subCount += 1;
  return `sub-smoke-${String(subCount).padStart(6, '0')}`;
}

const RUBRIC = {
  criteria: [
    {
      id: 'smoke_test',
      statement: 'スモークテストが正常に通ることを確認する基準文章20文字以上です。',
      weight: 1,
      verification: 'manual',
      anchors: {
        1: '全く動かないことが確認された',
        5: '一部だけ動くことが確認された',
        9: '完全に動作することが確認された',
      },
    },
  ],
};

test('T076 smoke: tools/list が固定順で7ツールを返す', () => {
  const result = handleToolsList();
  assert.equal(result.tools.length, 7);
  assert.deepEqual(
    result.tools.map((t) => t.name),
    ['loop_open', 'loop_state', 'artifact_commit', 'score_submit', 'rubric_amend', 'escalate', 'audit_export']
  );
  assert.equal(result.ttlMs, 86400000);
  assert.equal(result.cacheScope, 'private');
});

test('T076 smoke: 7ツールの最小疎通パイプラインが一時ディレクトリ内で完全に完走する', () => {
  const persistence = durablePersistence();

  // 1. loop_open
  const openRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'スモークテスト疎通確認タスク説明文20文字以上です',
      loop_mode: 'design',
      rubric: RUBRIC,
    },
    pluginRoot,
    persistence,
  });
  assert.equal(openRes.ok, true);
  assert.ok(openRes.session_id.startsWith('rl_'));
  assert.equal(openRes.state, 'DRAFTING');
  assert.equal(openRes.round, 1);

  // 2. loop_state
  const stateRes = loopState({
    input: {
      session_id: openRes.session_id,
      include: ['rubric', 'history', 'last_scores', 'must_fix'],
    },
    persistence,
  });
  assert.equal(stateRes.ok, true);
  assert.equal(stateRes.state, 'DRAFTING');

  // 3. rubric_amend
  const amendRes = rubricAmend({
    input: {
      session_id: openRes.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      criteria: [
        {
          ...RUBRIC.criteria[0],
          statement: 'スモークテスト基準文の明確化改定文章20文字以上です。',
        },
      ],
      reason: 'スモークテスト用のルーブリック明確化改定理由を確実に40文字以上満たす文章です。',
    },
    persistence,
  });
  assert.equal(amendRes.ok, true);
  assert.equal(amendRes.rubric_version, 2);

  // 4. artifact_commit
  const commitRes = artifactCommit({
    input: {
      session_id: openRes.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      content: '# 設計\nスモークテストの動作確認用本文です。完全に動作することが確認された。',
      change_note: '初回のスモークテスト用成果物コミット理由20文字以上です。',
    },
    persistence,
  });
  assert.equal(commitRes.ok, true);
  assert.equal(commitRes.state, 'SCORING');
  assert.ok(commitRes.artifact.digest.startsWith('sha256:'));

  // 5. score_submit
  const scoreRes = scoreSubmit({
    input: {
      session_id: openRes.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      artifact_digest: commitRes.artifact.digest,
      scores: [
        {
          criterion_id: 'smoke_test',
          score: 10,
          rationale: 'スモークテスト基準を満たしている詳細な評価理由を確実に40文字以上満たすように記述した文章です。',
          weakness: 'none',
          evidence: [
            {
              kind: 'locator',
              locator: '§1',
              excerpt: 'スモークテストの動作確認用本文です。完全に動作することが確認された。',
            },
          ],
        },
      ],
    },
    persistence,
  });
  assert.equal(scoreRes.ok, true);
  assert.equal(scoreRes.verdict, 'FINAL');
  assert.equal(scoreRes.state, 'FINAL');

  // 6. escalate (reopen from FINAL)
  const escRes = escalate({
    input: {
      session_id: openRes.session_id,
      submission_id: nextSubId(),
      action: 'reopen',
      human_token: 'valid-token-string-16-chars',
      note: 'スモークテスト用再オープン理由を確実に40文字以上満たすように長めに記述した文章です。',
    },
    persistence,
  });
  assert.equal(escRes.ok, true);
  assert.equal(escRes.state, 'DRAFTING');
  assert.equal(escRes.round, 2);

  // 7. audit_export
  const auditRes = auditExport({
    input: {
      session_id: openRes.session_id,
      scope: 'session',
    },
    persistence,
  });
  assert.equal(auditRes.ok, true);
  assert.ok(auditRes.export.path);
  assert.ok(existsSync(auditRes.export.path));
});

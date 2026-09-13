// AT-01〜AT-03: Round 1 即時終了防止・反復推敲強制受け入れテスト
// docs/plans/design-anti-round1-final.md §14
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { readSession } from '../src/store/session_store.js';

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-at-anti-r1-'));
}

function durablePersistence() {
  return { mode: 'durable', dir: tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-anti-r1-${submissionCounter}`.padEnd(8, '0');
}

const CONTENT_R1 = '# 設計書\nインターフェースは外部公開API仕様やエラー条件まで完全に定義されている。\nテストと受け入れ条件も全ケース網羅されている。';
const CONTENT_R2 = '# 設計書\nインターフェースは外部公開API仕様やエラー条件まで完全に定義されている。\nテストと受け入れ条件も全ケース網羅されている。\n第2周において更なる境界値網羅と品質改善を実施した。';

const EXCERPT_R1 = 'インターフェースは外部公開API仕様やエラー条件まで完全に定義されている。';
const EXCERPT_R2 = 'テストと受け入れ条件も全ケース網羅されている。';
const EXCERPT_R2_DIFF = '第2周において更なる境界値網羅と品質改善を実施した。';

const LONG_RATIONALE_1 = 'インターフェースが完全に定義されており、外部公開API仕様やエラー条件も漏れなく記述されていることを確認した。';
const LONG_RATIONALE_2 = '受け入れテストが完全に網羅されており、全テストケースの実行コマンドと終了コードが明記されていることを確認した。';

const VALID_WEAKNESS_1 = '境界値に関するドキュメントの記載が一部簡潔にとどまる';
const VALID_WEAKNESS_2 = '特殊エラー発生時の内部ログ出力フォーマットの記述が簡潔である';

function criterion(id) {
  return {
    id,
    statement: `${id} の基準を十分に満たしていることの根拠が示されている`,
    weight: 1,
    verification: 'manual',
    anchors: { 1: '全く満たさない', 5: '半分程度満たす', 9: '完全に満たす' },
  };
}

const RUBRIC_WITH_MIN_ROUNDS = {
  criteria: [criterion('interface_completeness'), criterion('acceptance_tests')],
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

const RUBRIC_WITH_MUST_FIX_POLICY = {
  criteria: [criterion('interface_completeness'), criterion('acceptance_tests')],
  policy: {
    pass_score: 9,
    pass_weighted_mean: 9.0,
    max_rounds: 12,
    min_rounds: 2,
    min_first_round_must_fix: 1,
    stall_window: 3,
    stall_epsilon: 0.25,
    max_score_jump: 3,
  },
};

test('AT-01: Round 1 で全項目9点を提出した場合の強制 ITERATING', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'Antigravity等におけるRound 1即時終了根絶の検証タスク',
      loop_mode: 'design',
      rubric: RUBRIC_WITH_MIN_ROUNDS,
    },
    persistence,
  });

  assert.equal(created.ok, true);
  assert.equal(created.state, 'DRAFTING');
  assert.equal(created.round, 1);

  const committed = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: CONTENT_R1,
      change_note: 'これは20文字以上の初版変更理由の説明文です',
    },
    persistence,
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.state, 'SCORING');

  const scored = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: [
        {
          criterion_id: 'interface_completeness',
          score: 9,
          rationale: LONG_RATIONALE_1,
          weakness: VALID_WEAKNESS_1,
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R1 }],
        },
        {
          criterion_id: 'acceptance_tests',
          score: 9,
          rationale: LONG_RATIONALE_2,
          weakness: VALID_WEAKNESS_2,
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R2 }],
        },
      ],
    },
    persistence,
  });

  assert.equal(scored.ok, true);
  assert.equal(scored.verdict, 'ITERATING');
  assert.equal(scored.verdict_reason, 'min_rounds_not_reached');
  assert.equal(scored.state, 'DRAFTING');
  assert.equal(scored.round, 2);

  const session = readSession(persistence.dir, created.session_id);
  assert.equal(session.state, 'DRAFTING');
  assert.equal(session.round, 2);
  assert.equal(session.counters.min_rounds_enforced_count, 1);
});

test('AT-02: 逃避的 Weakness 提出時の拒絶検査 (E_WEAKNESS_EVASIVE)', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'Antigravity等におけるRound 1即時終了根絶の検証タスク',
      loop_mode: 'design',
      rubric: RUBRIC_WITH_MIN_ROUNDS,
    },
    persistence,
  });

  const committed = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: CONTENT_R1,
      change_note: 'これは20文字以上の初版変更理由の説明文です',
    },
    persistence,
  });

  assert.throws(
    () => {
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: committed.artifact.digest,
          scores: [
            {
              criterion_id: 'interface_completeness',
              score: 8,
              rationale: LONG_RATIONALE_1,
              weakness: '本課題は次フェーズの将来課題とする',
              evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R1 }],
            },
            {
              criterion_id: 'acceptance_tests',
              score: 9,
              rationale: LONG_RATIONALE_2,
              weakness: VALID_WEAKNESS_2,
              evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R2 }],
            },
          ],
        },
        persistence,
      });
    },
    (err) => {
      assert.equal(err.code, 'E_WEAKNESS_EVASIVE');
      assert.equal(err.detail.criterion_id, 'interface_completeness');
      assert.ok(err.detail.matched_pattern);
      assert.ok(err.detail.weakness_excerpt);
      return true;
    }
  );

  const session = readSession(persistence.dir, created.session_id);
  assert.equal(session.state, 'SCORING');
  assert.equal(session.round, 1);
});

test('AT-03: Round 2 で改善を反映して提出した際の正常 FINAL', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'Antigravity等におけるRound 1即時終了根絶の検証タスク',
      loop_mode: 'design',
      rubric: RUBRIC_WITH_MIN_ROUNDS,
    },
    persistence,
  });

  // Round 1
  const c1 = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: CONTENT_R1,
      change_note: 'これは20文字以上の初版変更理由の説明文です',
    },
    persistence,
  });

  const s1 = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: c1.artifact.digest,
      scores: [
        {
          criterion_id: 'interface_completeness',
          score: 8,
          rationale: LONG_RATIONALE_1,
          weakness: 'エラーコードのスキーマ定義が一部未記載であるため加筆が必要',
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R1 }],
        },
        {
          criterion_id: 'acceptance_tests',
          score: 9,
          rationale: LONG_RATIONALE_2,
          weakness: VALID_WEAKNESS_2,
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R2 }],
        },
      ],
    },
    persistence,
  });

  assert.equal(s1.verdict, 'ITERATING');
  assert.equal(s1.round, 2);

  // Round 2
  const c2 = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content: CONTENT_R2,
      change_note: 'これは20文字以上の第2版改善変更理由の説明文です',
      addresses: ['interface_completeness'],
    },
    persistence,
  });

  const s2 = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      artifact_digest: c2.artifact.digest,
      scores: [
        {
          criterion_id: 'interface_completeness',
          score: 9,
          rationale: '第2周においてエラーコードのスキーマ定義を加筆し完全に要件を満たしたことを確認した。',
          weakness: VALID_WEAKNESS_1,
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R2_DIFF }],
        },
        {
          criterion_id: 'acceptance_tests',
          score: 9,
          rationale: LONG_RATIONALE_2,
          weakness: VALID_WEAKNESS_2,
          evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R2 }],
        },
      ],
    },
    persistence,
  });

  assert.equal(s2.ok, true);
  assert.equal(s2.verdict, 'FINAL');
  assert.equal(s2.verdict_reason, 'all_criteria_passed');
  assert.equal(s2.state, 'FINAL');

  const session = readSession(persistence.dir, created.session_id);
  assert.equal(session.state, 'FINAL');
});

test('Round 1 における E_FIRST_ROUND_UNCRITICAL の発火と拒絶', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'Antigravity等におけるRound 1即時終了根絶の検証タスク',
      loop_mode: 'design',
      rubric: RUBRIC_WITH_MUST_FIX_POLICY,
    },
    persistence,
  });

  const committed = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: CONTENT_R1,
      change_note: 'これは20文字以上の初版変更理由の説明文です',
    },
    persistence,
  });

  assert.throws(
    () => {
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: committed.artifact.digest,
          scores: [
            {
              criterion_id: 'interface_completeness',
              score: 9,
              rationale: LONG_RATIONALE_1,
              weakness: VALID_WEAKNESS_1,
              evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R1 }],
            },
            {
              criterion_id: 'acceptance_tests',
              score: 9,
              rationale: LONG_RATIONALE_2,
              weakness: VALID_WEAKNESS_2,
              evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT_R2 }],
            },
          ],
        },
        persistence,
      });
    },
    (err) => {
      assert.equal(err.code, 'E_FIRST_ROUND_UNCRITICAL');
      assert.equal(err.detail.round, 1);
      assert.equal(err.detail.failing_criteria_count, 0);
      assert.equal(err.detail.required_failing_count, 1);
      return true;
    }
  );
});

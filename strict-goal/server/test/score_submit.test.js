import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { appendIssueEvent, readIssueLedger } from '../src/evidence/issue_ledger.js';
import { readSession } from '../src/store/session_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-score-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-score-${submissionCounter}`.padEnd(8, '0');
}

const RUBRIC = {
  criteria: [
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
    {
      id: 'style_ok',
      statement: '文体が一貫し誤字脱字が無いことの根拠が十分に示されている',
      weight: 1,
      verification: 'manual',
      anchors: { 1: '文体がばらばら', 5: 'おおむね統一', 9: '完全に統一' },
    },
  ],
};

const ARTIFACT_CONTENT =
  '# 設計書\n実装は完全に期待通り動作することを確認した。\n文書は非常に明瞭に構成されていることが読んで分かる。\n文体は一貫していて読みやすく、誤字脱字も見当たらない。';

const EXCERPT = {
  impl_works: '実装は完全に期待通り動作することを確認した。',
  docs_clear: '文書は非常に明瞭に構成されていることが読んで分かる。',
  style_ok: '文体は一貫していて読みやすく、誤字脱字も見当たらない。',
};

function createSession(persistence) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: RUBRIC,
    },
    persistence,
  });
}

function commit(persistence, sessionId, expectedRound) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content: ARTIFACT_CONTENT,
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });
}

function score(criterionId, overrides = {}) {
  return {
    criterion_id: criterionId,
    score: 9,
    rationale: 'a'.repeat(45),
    weakness: 'b'.repeat(15),
    evidence: [{ kind: 'locator', locator: '§1', excerpt: EXCERPT[criterionId] }],
    ...overrides,
  };
}

function fullScores(overrides = {}) {
  return ['impl_works', 'docs_clear', 'style_ok'].map((id) => score(id, overrides[id]));
}

function setupScoredSession(persistence) {
  const created = createSession(persistence);
  const committed = commit(persistence, created.session_id, 1);
  return { created, committed };
}

function v2Context(persistence, created, committed) {
  const digest = (c) => `sha256:${c.repeat(64)}`;
  return { snapshot: { artifact_digest: committed.artifact.digest, rubric_digest: readSession(persistence.dir, created.session_id).rubric_digest, scope_digest: digest('a'), environment_digest: digest('b'), test_selection_digest: digest('c') }, condition_changes: [] };
}

test('score=8 は locator anchor を欠くと E_ISSUE_BINDING_REQUIRED になる', () => {
  const persistence = durablePersistence();
  persistence.roundReductionStage = 'enforce-new-session';
  const { created, committed } = setupScoredSession(persistence);
  const commandEvidence = {
    kind: 'command', command: 'node --test', exit_code: 0, output_excerpt: 'passing',
    output_sha256: 'a'.repeat(64), target_digest: committed.artifact.digest,
  };

  assert.throws(() => scoreSubmit({
    input: {
      session_id: created.session_id, submission_id: submissionId(), expected_round: 1,
      artifact_digest: committed.artifact.digest,
      evaluation_context: v2Context(persistence, created, committed),
      scores: fullScores({ impl_works: { score: 8, evidence: [commandEvidence] } }),
    },
    persistence,
  }), { code: 'E_ISSUE_BINDING_REQUIRED' });
});

test('score=8 の完全な binding は blocking issue を ledger に記録する', () => {
  const persistence = durablePersistence();
  persistence.roundReductionStage = 'enforce-new-session';
  const { created, committed } = setupScoredSession(persistence);
  const result = scoreSubmit({
    input: {
      session_id: created.session_id, submission_id: submissionId(), expected_round: 1,
      artifact_digest: committed.artifact.digest,
      evaluation_context: v2Context(persistence, created, committed),
      scores: fullScores({ impl_works: { score: 8 } }),
    },
    persistence,
  });

  assert.equal(result.ok, true);
  const issues = readIssueLedger(persistence.dir, created.session_id);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issue_id, 'ISS-score-impl_works');
  assert.equal(issues[0].blocking, true);
  const record = JSON.parse(readFileSync(path.join(persistence.dir, 'sessions', created.session_id, 'rounds', '1.json'), 'utf8'));
  assert.equal(record.metrics.phase, 'design');
  assert.match(record.metrics.snapshot_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(record.metrics.fresh_count, 3);
  assert.equal(record.metrics.reused_count, 0);
  assert.equal(record.metrics.issue_events[0].issue_id, issues[0].issue_id);
  assert.equal(record.metrics.tokens.total, 'unknown');
  assert.equal(record.metrics.timing_ms.wall, 'unknown');
});

test('score=9 でも open blocking issue があれば E_ISSUE_STATE_INVALID になる', () => {
  const persistence = durablePersistence();
  persistence.roundReductionStage = 'enforce-new-session';
  const { created, committed } = setupScoredSession(persistence);
  appendIssueEvent(persistence.dir, created.session_id, {
    issue_id: 'ISS-preexisting', lifecycle: 'opened', severity: 'blocking', blocking: true,
    criterion_ids: ['impl_works'], submission_id: submissionId(), round: 1,
  });

  assert.throws(() => scoreSubmit({
    input: {
      session_id: created.session_id, submission_id: submissionId(), expected_round: 1,
      artifact_digest: committed.artifact.digest, evaluation_context: v2Context(persistence, created, committed), scores: fullScores(),
    },
    persistence,
  }), { code: 'E_ISSUE_STATE_INVALID' });
});

test('artifact_digest がサーバ保持値と不一致のとき E_DIGEST_MISMATCH になる', () => {
  const persistence = durablePersistence();
  const { created } = setupScoredSession(persistence);
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: `sha256:${'0'.repeat(64)}`,
          scores: fullScores(),
        },
        persistence,
      }),
    { code: 'E_DIGEST_MISMATCH' },
  );
});

test('全基準を埋めていない提出は E_INCOMPLETE_SCORES になり detail に欠落 criterion_id が入る', () => {
  const persistence = durablePersistence();
  const { created, committed } = setupScoredSession(persistence);
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: committed.artifact.digest,
          scores: fullScores().filter((s) => s.criterion_id !== 'style_ok'),
        },
        persistence,
      }),
    (err) => err.code === 'E_INCOMPLETE_SCORES' && err.detail.missing.includes('style_ok'),
  );
});

test('score が10未満の基準に weakness:"none" を出すと E_WEAKNESS_REQUIRED になる', () => {
  const persistence = durablePersistence();
  const { created, committed } = setupScoredSession(persistence);
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          artifact_digest: committed.artifact.digest,
          scores: fullScores({ impl_works: { weakness: 'none' } }),
        },
        persistence,
      }),
    { code: 'E_WEAKNESS_REQUIRED' },
  );
});

test('rationale が39文字のとき E_VALIDATION、40文字は通る', () => {
  const persistence = durablePersistence();
  const { created, committed } = setupScoredSession(persistence);
  const base = { session_id: created.session_id, expected_round: 1, artifact_digest: committed.artifact.digest };

  assert.throws(
    () =>
      scoreSubmit({
        input: { ...base, submission_id: submissionId(), scores: fullScores({ impl_works: { rationale: 'a'.repeat(39) } }) },
        persistence,
      }),
    { code: 'E_VALIDATION' },
  );

  const result = scoreSubmit({
    input: { ...base, submission_id: submissionId(), scores: fullScores({ impl_works: { rationale: 'a'.repeat(40) } }) },
    persistence,
  });
  assert.equal(result.ok, true);
});

test('min_score>=9 かつ weighted_mean>=9.0 のとき verdict が FINAL になり round は進まない', () => {
  const persistence = durablePersistence();
  const { created, committed } = setupScoredSession(persistence);
  const result = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: fullScores(),
    },
    persistence,
  });
  assert.equal(result.verdict, 'FINAL');
  assert.equal(result.state, 'FINAL');
  assert.equal(result.evaluation.weighted_mean, 9);
  assert.equal(result.round, 1);
});

test('閾値未満のとき verdict が ITERATING になり must_fix が最低点3基準を昇順で返す', () => {
  const persistence = durablePersistence();
  const { created, committed } = setupScoredSession(persistence);
  const result = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: fullScores({
        impl_works: { score: 3 },
        docs_clear: { score: 7 },
        style_ok: { score: 5 },
      }),
    },
    persistence,
  });
  assert.equal(result.verdict, 'ITERATING');
  assert.equal(result.state, 'DRAFTING');
  assert.deepEqual(
    result.must_fix.map((m) => m.criterion_id),
    ['impl_works', 'style_ok', 'docs_clear'],
  );
  assert.equal(result.round, 2);
});

test('self_verdict_note は判定式に一切影響しない', () => {
  const persistence = durablePersistence();
  const a = setupScoredSession(persistence);
  const b = setupScoredSession(persistence);

  const resultA = scoreSubmit({
    input: {
      session_id: a.created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: a.committed.artifact.digest,
      scores: fullScores(),
      self_verdict_note: '全部完璧だと思う',
    },
    persistence,
  });
  const resultB = scoreSubmit({
    input: {
      session_id: b.created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: b.committed.artifact.digest,
      scores: fullScores(),
      self_verdict_note: '正直まだ不安がある',
    },
    persistence,
  });
  assert.equal(resultA.verdict, resultB.verdict);
  assert.equal(resultA.evaluation.weighted_mean, resultB.evaluation.weighted_mean);
});

test('受理された提出は rounds/<round>.json に、拒否された提出は rounds/<round>.rejected/<n>.json に error_code 付きで残る', () => {
  const persistence = durablePersistence();
  const { created, committed } = setupScoredSession(persistence);
  const sDir = path.join(persistence.dir, 'sessions', created.session_id);

  assert.throws(() =>
    scoreSubmit({
      input: {
        session_id: created.session_id,
        submission_id: submissionId(),
        expected_round: 1,
        artifact_digest: `sha256:${'0'.repeat(64)}`,
        scores: fullScores(),
      },
      persistence,
    }),
  );
  const rejectedPath = path.join(sDir, 'rounds', '1.rejected', '1.json');
  assert.ok(existsSync(rejectedPath));
  const rejected = JSON.parse(readFileSync(rejectedPath, 'utf8'));
  assert.equal(rejected.error_code, 'E_DIGEST_MISMATCH');

  const result = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: fullScores(),
    },
    persistence,
  });
  assert.equal(result.verdict, 'FINAL');
  const acceptedPath = path.join(sDir, 'rounds', '1.json');
  assert.ok(existsSync(acceptedPath));
  const accepted = JSON.parse(readFileSync(acceptedPath, 'utf8'));
  assert.equal(accepted.verdict, 'FINAL');
});

test('事前検証失敗は監査され、同じ bytes の再送は round も event 数も変えない', () => {
  const persistence = durablePersistence();
  const { created, committed } = setupScoredSession(persistence);
  const sDir = path.join(persistence.dir, 'sessions', created.session_id);
  const input = {
    session_id: created.session_id,
    submission_id: submissionId(),
    expected_round: 1,
    artifact_digest: committed.artifact.digest,
    scores: fullScores({ impl_works: { unexpected: true } }),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.throws(() => scoreSubmit({ input, persistence }), { code: 'E_VALIDATION' });
  }
  const rejectedDir = path.join(sDir, 'rounds', '1.rejected');
  assert.equal(readdirSync(rejectedDir).length, 1);
  const record = JSON.parse(readFileSync(path.join(rejectedDir, '1.json'), 'utf8'));
  assert.equal(record.event_type, 'rejected_prevalidation');
  assert.equal(record.error_code, 'E_VALIDATION');
  assert.equal(JSON.parse(readFileSync(path.join(sDir, 'session.json'), 'utf8')).round, 1);
});

test('事前検証は committed digest と locator excerpt を厳密に照合する', () => {
  const persistence = durablePersistence();
  persistence.roundReductionStage = 'enforce-new-session';
  const { created, committed } = setupScoredSession(persistence);
  const sDir = path.join(persistence.dir, 'sessions', created.session_id);
  const base = {
    session_id: created.session_id,
    expected_round: 1,
    scores: fullScores(),
  };
  assert.throws(() => scoreSubmit({
    input: { ...base, submission_id: submissionId(), artifact_digest: `sha256:${'0'.repeat(64)}` },
    persistence,
  }), { code: 'E_DIGEST_MISMATCH' });
  assert.throws(() => scoreSubmit({
    input: {
      ...base,
      submission_id: submissionId(),
      artifact_digest: committed.artifact.digest,
      scores: fullScores({ impl_works: { evidence: [{ kind: 'locator', locator: '§1', excerpt: '実装は 完全に期待通り動作することを確認した。' }] } }),
    },
    persistence,
  }), { code: 'E_EVIDENCE_EXCERPT_MISMATCH' });
  const rejectedDir = path.join(sDir, 'rounds', '1.rejected');
  assert.equal(readdirSync(rejectedDir).length, 2);
  assert.equal(JSON.parse(readFileSync(path.join(sDir, 'session.json'), 'utf8')).round, 1);
});

test('buildMustFix は priority 降順 -> スコア昇順で並び替え、高優先・高得点が低優先・低得点より先頭に来る', () => {
  const persistence = durablePersistence();
  const rubricWithPriority = {
    criteria: [
      {
        id: 'low_prio_low_score',
        statement: '0123456789012345',
        weight: 1,
        priority: 0,
        verification: 'manual',
        anchors: { 1: 'weak-1', 5: 'fair-5', 9: 'good-9' },
      },
      {
        id: 'high_prio_high_score',
        statement: '0123456789012345',
        weight: 1,
        priority: 3,
        verification: 'manual',
        anchors: { 1: 'weak-1', 5: 'fair-5', 9: 'good-9' },
      },
      {
        id: 'mid_prio',
        statement: '0123456789012345',
        weight: 1,
        priority: 2,
        verification: 'manual',
        anchors: { 1: 'weak-1', 5: 'fair-5', 9: 'good-9' },
      },
      {
        id: 'fourth_criterion',
        statement: '0123456789012345',
        weight: 1,
        priority: 0,
        verification: 'manual',
        anchors: { 1: 'weak-1', 5: 'fair-5', 9: 'good-9' },
      },
    ],
  };
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: submissionId(),
      task: 'サンプルタスクの説明文で20文字以上になるようにする',
      loop_mode: 'design',
      rubric: rubricWithPriority,
    },
    persistence,
  });
  const committed = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: '本文は十分な長さを持っており検証可能な文です。\n'.repeat(10),
      change_note: 'これは20文字以上ある変更理由の説明文です',
    },
    persistence,
  });

  const result = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed.artifact.digest,
      scores: [
        {
          criterion_id: 'low_prio_low_score',
          score: 5,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: '本文は十分な長さを持っており検証可能な文です。' }],
        },
        {
          criterion_id: 'high_prio_high_score',
          score: 8,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: '本文は十分な長さを持っており検証可能な文です。' }],
        },
        {
          criterion_id: 'mid_prio',
          score: 6,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: '本文は十分な長さを持っており検証可能な文です。' }],
        },
        {
          criterion_id: 'fourth_criterion',
          score: 4,
          rationale: 'a'.repeat(45),
          weakness: 'b'.repeat(15),
          evidence: [{ kind: 'locator', locator: '§1', excerpt: '本文は十分な長さを持っており検証可能な文です。' }],
        },
      ],
    },
    persistence,
  });

  assert.equal(result.verdict, 'ITERATING');
  assert.equal(result.must_fix.length, 3);
  assert.deepEqual(
    result.must_fix.map((m) => m.criterion_id),
    ['high_prio_high_score', 'mid_prio', 'fourth_criterion'],
  );
});

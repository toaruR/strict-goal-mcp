import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';

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

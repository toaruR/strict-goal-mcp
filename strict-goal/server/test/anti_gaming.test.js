import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-anti-gaming-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-ag-${submissionCounter}`.padEnd(8, '0');
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
  ],
};

const CONTENT_V1 =
  '# 設計書\n実装は一部だけ動作することを目視で確認したという記録がある。\n詳細な実行ログを見ても実装の一部動作が確認できたという記録がある。\n文書は非常に明瞭に構成されていることが読んで分かるという評価がある。';
const CONTENT_V2 = `${CONTENT_V1}\n追加の一文がここに入る、という補足説明である。`;

const EXCERPT_IMPL_A = '実装は一部だけ動作することを目視で確認したという記録がある。';
const EXCERPT_IMPL_B = '詳細な実行ログを見ても実装の一部動作が確認できたという記録がある。';
const EXCERPT_DOCS = '文書は非常に明瞭に構成されていることが読んで分かるという評価がある。';

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

function commit(persistence, sessionId, content, expectedRound, addresses) {
  return artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: submissionId(),
      expected_round: expectedRound,
      content,
      change_note: 'これは20文字以上ある変更理由の説明文です',
      ...(addresses ? { addresses } : {}),
    },
    persistence,
  });
}

function locatorScore(criterionId, scoreValue, excerpt, overrides = {}) {
  return {
    criterion_id: criterionId,
    score: scoreValue,
    rationale: 'a'.repeat(45),
    weakness: scoreValue === 10 ? 'none' : 'b'.repeat(15),
    evidence: [{ kind: 'locator', locator: '§1', excerpt }],
    ...overrides,
  };
}

function commandEvidence(count) {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'command',
    command: `npm test -- --n=${i}`,
    exit_code: 0,
    output_excerpt: 'ok',
    output_sha256: 'a'.repeat(64),
  }));
}

test('digest 不変で1基準だけ +1 した提出は E_SCORE_INFLATION になり detail に上がった criterion_id が入る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);

  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed1.artifact.digest,
      scores: [locatorScore('impl_works', 5, EXCERPT_IMPL_A), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
    },
    persistence,
  });

  // round2: 同一内容を再 commit(digest 不変)してから、impl_works だけ +1 する。
  const committed2 = commit(persistence, created.session_id, CONTENT_V1, 2, ['impl_works']);
  assert.equal(committed2.artifact.unchanged, true);

  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 2,
          artifact_digest: committed2.artifact.digest,
          scores: [locatorScore('impl_works', 6, EXCERPT_IMPL_B), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
        },
        persistence,
      }),
    (err) => err.code === 'E_SCORE_INFLATION' && err.detail.criteria.some((c) => c.criterion_id === 'impl_works'),
  );
});

test('digest 不変でスコアが全部同じ、または下がった提出は受理される', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);

  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed1.artifact.digest,
      scores: [locatorScore('impl_works', 5, EXCERPT_IMPL_A), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
    },
    persistence,
  });

  const committed2 = commit(persistence, created.session_id, CONTENT_V1, 2, ['impl_works']);
  const result = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      artifact_digest: committed2.artifact.digest,
      scores: [locatorScore('impl_works', 4, EXCERPT_IMPL_B), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
    },
    persistence,
  });
  assert.equal(result.ok, true);
});

test('1周で +4 の上昇があり command 根拠が1件のとき E_SCORE_JUMP になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);

  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed1.artifact.digest,
      scores: [locatorScore('impl_works', 3, EXCERPT_IMPL_A), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
    },
    persistence,
  });

  const committed2 = commit(persistence, created.session_id, CONTENT_V2, 2, ['impl_works']);
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 2,
          artifact_digest: committed2.artifact.digest,
          scores: [
            locatorScore('impl_works', 7, EXCERPT_IMPL_A, { evidence: [...commandEvidence(1)] }),
            locatorScore('docs_clear', 9, EXCERPT_DOCS),
          ],
        },
        persistence,
      }),
    { code: 'E_SCORE_JUMP' },
  );
});

test('1周で +4 の上昇でも exit_code:0 の command 根拠が2件あれば受理される', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);

  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed1.artifact.digest,
      scores: [locatorScore('impl_works', 3, EXCERPT_IMPL_A), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
    },
    persistence,
  });

  const committed2 = commit(persistence, created.session_id, CONTENT_V2, 2, ['impl_works']);
  const result = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      artifact_digest: committed2.artifact.digest,
      scores: [
        locatorScore('impl_works', 7, EXCERPT_IMPL_A, { evidence: [...commandEvidence(2)] }),
        locatorScore('docs_clear', 9, EXCERPT_DOCS),
      ],
    },
    persistence,
  });
  assert.equal(result.ok, true);
});

test('スコアが上昇した基準で前周と同一の evidence_digest を出すと E_EVIDENCE_STALE になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);

  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed1.artifact.digest,
      scores: [locatorScore('impl_works', 5, EXCERPT_IMPL_A), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
    },
    persistence,
  });

  const committed2 = commit(persistence, created.session_id, CONTENT_V2, 2, ['impl_works']);
  assert.throws(
    () =>
      scoreSubmit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 2,
          artifact_digest: committed2.artifact.digest,
          scores: [locatorScore('impl_works', 6, EXCERPT_IMPL_A), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
        },
        persistence,
      }),
    (err) => err.code === 'E_EVIDENCE_STALE' && err.detail.criterion_id === 'impl_works',
  );
});

test('スコアが上昇していない基準では同一 evidence_digest の再提出が許される', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const committed1 = commit(persistence, created.session_id, CONTENT_V1, 1);

  scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      artifact_digest: committed1.artifact.digest,
      scores: [locatorScore('impl_works', 5, EXCERPT_IMPL_A), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
    },
    persistence,
  });

  const committed2 = commit(persistence, created.session_id, CONTENT_V2, 2, ['impl_works']);
  const result = scoreSubmit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      artifact_digest: committed2.artifact.digest,
      // impl_works は違う根拠で加点、docs_clear は前周と同一 evidence を使い回すがスコアは9のまま。
      scores: [locatorScore('impl_works', 6, EXCERPT_IMPL_B), locatorScore('docs_clear', 9, EXCERPT_DOCS)],
    },
    persistence,
  });
  assert.equal(result.ok, true);
});

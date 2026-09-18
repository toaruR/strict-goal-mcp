import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { readSession, writeSession } from '../src/store/session_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-commit-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-commit-${submissionCounter}`.padEnd(8, '0');
}

function createSession(persistence, overrides = {}) {
  const input = {
    mode: 'create',
    submission_id: submissionId(),
    task: 'サンプルタスクの説明文で20文字以上になるようにする',
    loop_mode: 'design',
    ...overrides,
  };
  return loopOpenCreate({ input, pluginRoot, persistence });
}

const CHANGE_NOTE = 'これは20文字以上ある変更理由の説明文です';

test('commit 後に state が SCORING になり artifact_digest が返る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const result = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: '# 設計書\n本文です。',
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'SCORING');
  assert.match(result.artifact.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.artifact.unchanged, false);
  assert.equal(result.artifact.previous_digest, null);
});

test('同一内容を2回 commit しても artifacts/ に1ファイルしか増えない', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const content = '# 設計書\n同一内容です。';

  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content, change_note: CHANGE_NOTE },
    persistence,
  });

  // 2周目に進めてから同じ内容を再 commit する。
  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  writeSession(persistence.dir, session);

  const result2 = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content,
      change_note: CHANGE_NOTE,
      addresses: [],
    },
    persistence,
  });

  assert.equal(result2.artifact.unchanged, true);
  const artifactsDir = path.join(persistence.dir, 'sessions', created.session_id, 'artifacts');
  const files = readdirSync(artifactsDir).filter((name) => name !== 'index.json');
  assert.equal(files.length, 1);
});

test('artifacts/index.json に round -> digest の対応が記録される', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const result = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: '# 設計書\n本文です。',
      change_note: CHANGE_NOTE,
    },
    persistence,
  });

  const indexPath = path.join(persistence.dir, 'sessions', created.session_id, 'artifacts', 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  assert.equal(index['1'], result.artifact.digest);
});

test('round>=2 で addresses が前周 must_fix[0].criterion_id を含まないとき E_ADDRESS_MISSING になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文1', change_note: CHANGE_NOTE },
    persistence,
  });

  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  session.last_evaluation = {
    scores: [{ criterion_id: 'crit_a', score: 3, passed: false }],
    must_fix: [{ criterion_id: 'crit_a', score: 3, gap: 6, anchor_9: '9点相当', verify_hint: '検証方法' }],
  };
  writeSession(persistence.dir, session);

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 2,
          content: '# 本文2',
          change_note: CHANGE_NOTE,
          addresses: ['crit_b'],
        },
        persistence,
      }),
    { code: 'E_ADDRESS_MISSING' },
  );
});

test('content が1000001バイトのとき E_VALIDATION になり、1000000バイトは通る', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  assert.throws(
    () =>
      artifactCommit({
        input: {
          session_id: created.session_id,
          submission_id: submissionId(),
          expected_round: 1,
          content: 'a'.repeat(1_000_001),
          change_note: CHANGE_NOTE,
        },
        persistence,
      }),
    { code: 'E_VALIDATION' },
  );

  const result = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 1,
      content: 'a'.repeat(1_000_000),
      change_note: CHANGE_NOTE,
    },
    persistence,
  });
  assert.equal(result.ok, true);
});

test('SCORING 状態での artifact_commit が E_STATE_VIOLATION になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文', change_note: CHANGE_NOTE },
    persistence,
  });

  assert.throws(
    () =>
      artifactCommit({
        input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: '# 本文2', change_note: CHANGE_NOTE },
        persistence,
      }),
    { code: 'E_STATE_VIOLATION' },
  );
});

test('同一 submission_id の再送で artifacts/ が増えない', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const subId = submissionId();
  const input = {
    session_id: created.session_id,
    submission_id: subId,
    expected_round: 1,
    content: '# 本文',
    change_note: CHANGE_NOTE,
  };

  const first = artifactCommit({ input, persistence });
  const second = artifactCommit({ input, persistence });
  assert.deepEqual(first, second);

  const artifactsDir = path.join(persistence.dir, 'sessions', created.session_id, 'artifacts');
  const files = readdirSync(artifactsDir).filter((name) => name !== 'index.json');
  assert.equal(files.length, 1);
});

test('expected_round が現在の round と一致しないとき E_CONCURRENT になる', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  assert.throws(
    () =>
      artifactCommit({
        input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 99, content: '# 本文', change_note: CHANGE_NOTE },
        persistence,
      }),
    { code: 'E_CONCURRENT' },
  );
});

test('前周が十分大きく全く重ならない極小 content に差し替えると destructive_overwrite が付く', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);
  const bigContent = Array.from({ length: 300 }, (_, i) => `本文の行${i}です。詳細な説明がここに入ります。`).join('\n');

  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: bigContent, change_note: CHANGE_NOTE },
    persistence,
  });

  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  writeSession(persistence.dir, session);

  const result = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content: 'placeholder',
      change_note: CHANGE_NOTE,
      addresses: [],
    },
    persistence,
  });

  assert.ok(result.warnings.includes('near_total_rewrite'));
  assert.ok(result.warnings.includes('suspicious_shrink'));
  assert.ok(result.warnings.includes('destructive_overwrite'));
});

test('前周が小さいときは同様の縮小でも destructive_overwrite は付かない', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: '# 短い本文\n最初の版です。', change_note: CHANGE_NOTE },
    persistence,
  });

  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  writeSession(persistence.dir, session);

  const result = artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: submissionId(),
      expected_round: 2,
      content: 'x',
      change_note: CHANGE_NOTE,
      addresses: [],
    },
    persistence,
  });

  assert.ok(!result.warnings.includes('destructive_overwrite'));
});

test('末尾20%の追記見出しで appendix_accretion 警告が出ること、先頭側では出ないこと、フェンス内は除外されること', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  // 1. 先頭側に追記見出しがある場合（全体10行、2行目）-> 警告なし
  const frontContent = ['# 設計書', '## 変更履歴', ...Array.from({ length: 15 }, (_, i) => `本文行${i}です。`)].join('\n');
  const resFront = artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: frontContent, change_note: CHANGE_NOTE },
    persistence,
  });
  assert.ok(!resFront.warnings.includes('appendix_accretion'));

  // 2. 末尾20%に追記見出しがある場合（全体20行、19行目）-> 警告あり
  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  writeSession(persistence.dir, session);

  const tailContent = [...Array.from({ length: 18 }, (_, i) => `本文行${i}です。`), '## 21. 設計自己検証の記録', '検証結果の内容です。'].join('\n');
  const resTail = artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 2, content: tailContent, change_note: CHANGE_NOTE, addresses: [] },
    persistence,
  });
  assert.ok(resTail.warnings.includes('appendix_accretion'));
  assert.equal(resTail.ok, true);

  // 3. 末尾にあってもコードフェンス内の見出し行なら除外される
  session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 3;
  writeSession(persistence.dir, session);

  const fenceContent = [...Array.from({ length: 18 }, (_, i) => `本文行${i}です。`), '```markdown', '## 変更履歴', '```'].join('\n');
  const resFence = artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 3, content: fenceContent, change_note: CHANGE_NOTE, addresses: [] },
    persistence,
  });
  assert.ok(!resFence.warnings.includes('appendix_accretion'));
});

test('policy.scope_guard_terms で指定された語が見出しに含まれるとき out_of_scope_section 警告が出ること、フェンス内や未指定では出ないこと', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, {
    rubric: {
      criteria: [
        {
          id: 'c1',
          statement: '0123456789012345',
          weight: 1,
          verification: 'manual',
          anchors: { 1: 'weak-1', 5: 'fair-5', 9: 'good-9' },
        },
      ],
      policy: {
        scope_guard_terms: ['配布', 'CI'],
      },
    },
  });

  // 1. scope_guard_terms の語を含む見出しがある本文 -> out_of_scope_section 警告
  const contentWithScope = '# 本文のタイトル\n## 配布パッケージとホスト互換性\n本文の内容です。';
  const res1 = artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: contentWithScope, change_note: CHANGE_NOTE },
    persistence,
  });
  assert.ok(res1.warnings.includes('out_of_scope_section'));
  assert.equal(res1.ok, true);

  // 2. コードフェンス内に対象語がある場合 -> 見出しとみなされず警告なし
  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  writeSession(persistence.dir, session);

  const fenceContent = '# 本文のタイトル\n```markdown\n## 配布パッケージ\n```\n本文の内容です。';
  const resFence = artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 2, content: fenceContent, change_note: CHANGE_NOTE, addresses: [] },
    persistence,
  });
  assert.ok(!resFence.warnings.includes('out_of_scope_section'));

  // 3. scope_guard_terms が未指定または [] のセッション -> 警告なし
  const sessionNoTerms = createSession(persistence);
  const resNoTerms = artifactCommit({
    input: { session_id: sessionNoTerms.session_id, submission_id: submissionId(), expected_round: 1, content: contentWithScope, change_note: CHANGE_NOTE },
    persistence,
  });
  assert.ok(!resNoTerms.warnings.includes('out_of_scope_section'));
});

test('policy.artifact_budget_bytes を超える本文で over_budget 警告が出ること、未設定や予算内では出ないこと', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence, {
    rubric: {
      criteria: [
        {
          id: 'c1',
          statement: '0123456789012345',
          weight: 1,
          verification: 'manual',
          anchors: { 1: 'weak-1', 5: 'fair-5', 9: 'good-9' },
        },
      ],
      policy: {
        artifact_budget_bytes: 28000,
      },
    },
  });

  // 1. 28001 バイトの本文 -> over_budget 警告が出る
  const bigContent = 'a'.repeat(28001);
  const resBig = artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 1, content: bigContent, change_note: CHANGE_NOTE },
    persistence,
  });
  assert.ok(resBig.warnings.includes('over_budget'));
  assert.equal(resBig.ok, true);

  // 2. 28000 バイト以下の本文 -> over_budget 警告は出ない
  let session = readSession(persistence.dir, created.session_id);
  session.state = 'DRAFTING';
  session.round = 2;
  writeSession(persistence.dir, session);

  const smallContent = 'b'.repeat(27000);
  const resSmall = artifactCommit({
    input: { session_id: created.session_id, submission_id: submissionId(), expected_round: 2, content: smallContent, change_note: CHANGE_NOTE, addresses: [] },
    persistence,
  });
  assert.ok(!resSmall.warnings.includes('over_budget'));

  // 3. artifact_budget_bytes 未設定のセッション（policy に未指定） -> over_budget 警告は出ない
  const normalSession = createSession(persistence, {
    rubric: {
      criteria: [
        {
          id: 'c1',
          statement: '0123456789012345',
          weight: 1,
          verification: 'manual',
          anchors: { 1: 'weak-1', 5: 'fair-5', 9: 'good-9' },
        },
      ],
      policy: {},
    },
  });
  const resNormal = artifactCommit({
    input: { session_id: normalSession.session_id, submission_id: submissionId(), expected_round: 1, content: bigContent, change_note: CHANGE_NOTE },
    persistence,
  });
  assert.ok(!resNormal.warnings.includes('over_budget'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { rubricAmend } from '../src/tools/rubric_amend.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { diffRubric } from '../src/rubric/diff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-amend-err-'));
}

function durablePersistence(dir = tmpDataDir()) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCount = 0;
function nextSubId() {
  subCount += 1;
  return `sub-amend-err-${String(subCount).padStart(6, '0')}`;
}

const CRITERION_A = {
  id: 'crit_a',
  statement: '基準Aの説明文で20文字以上になるように十分に記述した文章です。',
  weight: 2,
  verification: 'manual',
  anchors: {
    1: 'アンカー1の記述で5文字以上',
    5: 'アンカー5の記述で5文字以上',
    9: 'アンカー9の記述で5文字以上',
  },
};

const CRITERION_B = {
  id: 'crit_b',
  statement: '基準Bの説明文で20文字以上になるように十分に記述した文章です。',
  weight: 1,
  verification: 'manual',
  anchors: {
    1: 'アンカー1の記述で5文字以上',
    5: 'アンカー5の記述で5文字以上',
    9: 'アンカー9の記述で5文字以上',
  },
};

const VALID_REASON = 'ルーブリック改定の理由を確実に40文字以上満たすように長めに記述した変更説明の文章です。';

function setupSession(persistence, overrides = {}) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'ルーブリック改定エラーテスト用タスク説明文20文字以上です',
      loop_mode: 'design',
      rubric: {
        criteria: [CRITERION_A, CRITERION_B],
      },
      ...overrides,
    },
    pluginRoot,
    persistence,
  });
}

const EXPECTED_RUBRIC_AMEND_ERRORS = new Set([
  'E_STATE_VIOLATION',
  'E_CONCURRENT',
  'E_THRESHOLD_IMMUTABLE',
  'E_RELAXATION_UNACKNOWLEDGED',
  'E_VALIDATION',
]);

const observedErrors = new Set();

function recordError(persistence, sessionId, fn) {
  const beforeSession = sessionId ? readSession(persistence.dir, sessionId) : null;
  const beforeRound = beforeSession?.round;
  try {
    fn();
    assert.fail('Expected function to throw error');
  } catch (err) {
    assert.ok(err.code, `Error must have code, got: ${err.message}`);
    assert.notEqual(err.code, 'ERR_ASSERTION');
    observedErrors.add(err.code);
    if (sessionId) {
      const afterSession = readSession(persistence.dir, sessionId);
      assert.equal(afterSession.round, beforeRound, 'Session round must not advance on rejected rubric_amend');
    }
    return err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. E_VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
test('T072 rubric_amend: E_VALIDATION on schema error (e.g. reason < 40 chars)', () => {
  const persistence = durablePersistence();
  const created = setupSession(persistence);

  const err = recordError(persistence, created.session_id, () =>
    rubricAmend({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        criteria: [CRITERION_A, CRITERION_B],
        reason: '短すぎる理由文', // < 40 chars
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_VALIDATION');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. E_STATE_VIOLATION
// ─────────────────────────────────────────────────────────────────────────────
test('T072 rubric_amend: E_STATE_VIOLATION when called in SCORING state (after commit)', () => {
  const persistence = durablePersistence();
  const created = setupSession(persistence);

  // Commit to transition to SCORING
  artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      content: '# 成果物\nこれはテスト成果物の本文です。',
      change_note: 'これは20文字以上ある変更理由の説明文です。',
    },
    persistence,
  });

  const err = recordError(persistence, created.session_id, () =>
    rubricAmend({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        criteria: [CRITERION_A, CRITERION_B],
        reason: VALID_REASON,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_STATE_VIOLATION');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. E_CONCURRENT
// ─────────────────────────────────────────────────────────────────────────────
test('T072 rubric_amend: E_CONCURRENT when expected_round does not match session round', () => {
  const persistence = durablePersistence();
  const created = setupSession(persistence);

  const err = recordError(persistence, created.session_id, () =>
    rubricAmend({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 99,
        criteria: [CRITERION_A, CRITERION_B],
        reason: VALID_REASON,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_CONCURRENT');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. E_RELAXATION_UNACKNOWLEDGED
// ─────────────────────────────────────────────────────────────────────────────
test('T072 rubric_amend: E_RELAXATION_UNACKNOWLEDGED when relaxation change lacks acknowledge_relaxation', () => {
  const persistence = durablePersistence();
  const created = setupSession(persistence);

  // Lower weight of CRITERION_A from 2 to 1 (relaxation)
  const relaxedCritA = { ...CRITERION_A, weight: 1 };

  const err = recordError(persistence, created.session_id, () =>
    rubricAmend({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        criteria: [relaxedCritA, CRITERION_B],
        reason: VALID_REASON,
        acknowledge_relaxation: false,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_RELAXATION_UNACKNOWLEDGED');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. E_THRESHOLD_IMMUTABLE
// ─────────────────────────────────────────────────────────────────────────────
test('T072 rubric_amend: E_THRESHOLD_IMMUTABLE when policy threshold modification is attempted', () => {
  // As documented in §6.4.5, §14.3.4, and CLAUDE.md gotchas, rubric_amend's tool input schema
  // has additionalProperties:false and does not accept policy, so policy changes are structurally
  // rejected by schema (E_VALIDATION) on the public tool interface, while diffRubric directly
  // enforces E_THRESHOLD_IMMUTABLE if a policy change reaches it.
  const prevRubric = {
    criteria: [CRITERION_A],
    policy: { pass_score: 9, pass_weighted_mean: 9, max_score_jump: 3 },
  };
  const nextRubric = {
    criteria: [CRITERION_A],
    policy: { pass_score: 8, pass_weighted_mean: 9, max_score_jump: 3 }, // modified pass_score
  };

  try {
    diffRubric(prevRubric, nextRubric);
    assert.fail('Expected diffRubric to throw E_THRESHOLD_IMMUTABLE');
  } catch (err) {
    assert.equal(err.code, 'E_THRESHOLD_IMMUTABLE');
    observedErrors.add(err.code);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Exhaustiveness verification
// ─────────────────────────────────────────────────────────────────────────────
test('T072 verification: exactly 5 error codes covered and no unexpected code', () => {
  assert.equal(observedErrors.size, 5, `Expected exactly 5 error codes, got ${observedErrors.size}`);
  assert.deepEqual(
    Array.from(observedErrors).sort(),
    Array.from(EXPECTED_RUBRIC_AMEND_ERRORS).sort(),
    'Observed error codes must match expected set exactly'
  );
});

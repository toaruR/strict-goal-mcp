import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopState } from '../src/tools/loop_state.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { escalate } from '../src/tools/escalate.js';
import { readSession, writeSession } from '../src/store/session_store.js';
import { saveContentArtifact } from '../src/artifact/store.js';
import { readChain } from '../src/chain/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-esc-err-'));
}

function durablePersistence(dir = tmpDataDir()) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCount = 0;
function nextSubId() {
  subCount += 1;
  return `sub-esc-err-${String(subCount).padStart(6, '0')}`;
}

const VALID_NOTE = 'エスカレーション処理の理由を確実に40文字以上満たすように長めに記述した変更説明の文章です。';

const RUBRIC = {
  criteria: [
    {
      id: 'impl_works',
      statement: '実装が仕様どおりに動作することの根拠が十分に示されている',
      weight: 1,
      verification: 'manual',
      anchors: { 1: '全く動かないことが確認された', 5: '一部だけ動くことが確認された', 9: '完全に動作することが確認された' },
    },
  ],
};

function createSession(persistence, overrides = {}) {
  return loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'エスカレーションテスト用タスク説明文20文字以上です',
      loop_mode: 'design',
      rubric: RUBRIC,
      ...overrides,
    },
    pluginRoot,
    persistence,
  });
}

function buildSupersededPlan(persistence) {
  const design = createSession(persistence, { loop_mode: 'design' });
  const sDir = path.join(persistence.dir, 'sessions', design.session_id);
  const designContentV1 = '# 設計\n実装は完全に動作することを実行ログで確認したという記録がある。';
  const c1 = artifactCommit({
    input: {
      session_id: design.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      content: designContentV1,
      change_note: 'これは20文字以上ある変更理由の説明文です。',
    },
    persistence,
  });
  const ds = readSession(persistence.dir, design.session_id);
  ds.state = 'FINAL';
  writeSession(persistence.dir, ds);

  const plan = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '下流計画セッション作成用タスク説明文20文字以上です',
      loop_mode: 'plan',
      upstream: { session_id: design.session_id, artifact_digest: c1.artifact.digest },
    },
    pluginRoot,
    persistence,
  });

  const planContent = JSON.stringify({
    plan_version: 1,
    summary: 'これは計画全体の概要を説明する詳細な計画サマリーです。40文字以上の長さを確実に満たすための文章記述です。',
    tasks: [
      {
        id: 'T001',
        title: 'タスク1の実装と検証を行う',
        intent: 'タスク1の意図を20文字以上で記述するための文字列です',
        depends_on: [],
        design_refs: ['# 設計'],
        changes: [{ path: 'src/a.js', kind: 'add' }],
        acceptance: ['受け入れ条件1が10文字以上になるように書く'],
        verify: [{ command: 'node --test', expect_exit_code: 0 }],
      },
    ],
  });
  const pc = artifactCommit({
    input: {
      session_id: plan.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      content: planContent,
      change_note: 'これは20文字以上ある変更理由の説明文です。',
    },
    persistence,
  });

  // Mutate design to V2
  const designContentV2 = '# 設計\n更新された別の設計記録に置き換えられている。';
  const { digest: designDigestV2, bytes } = saveContentArtifact(sDir, 'markdown', designContentV2);
  ds.current_artifact = { digest: designDigestV2, bytes, committed_at: new Date().toISOString() };
  writeSession(persistence.dir, ds);

  // Trigger supersede check via loopState
  loopState({ input: { session_id: plan.session_id }, persistence });
  assert.equal(readSession(persistence.dir, plan.session_id).state, 'SUPERSEDED');

  return { design, plan, designDigestV2 };
}

const EXPECTED_ESCALATE_ERRORS = new Set([
  'E_STATE_VIOLATION',
  'E_TOKEN_INVALID',
  'E_RESOLUTION_NOT_APPLICABLE',
  'E_VALIDATION',
  'E_UPSTREAM_NOT_FOUND',
  'E_UPSTREAM_DIGEST_MISMATCH',
  'E_CHAIN_BUDGET_EXHAUSTED',
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
      assert.equal(afterSession.round, beforeRound, 'Session round must not advance on rejected escalate');
    }
    return err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. E_VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
test('T073 escalate: E_VALIDATION on missing required action inputs (e.g. resolve without human_token)', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  const err = recordError(persistence, created.session_id, () =>
    escalate({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        action: 'resolve',
        resolution: 'continue',
        // human_token missing
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_VALIDATION');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. E_STATE_VIOLATION
// ─────────────────────────────────────────────────────────────────────────────
test('T073 escalate: E_STATE_VIOLATION when reopen called from DRAFTING state', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  const err = recordError(persistence, created.session_id, () =>
    escalate({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        action: 'reopen',
        human_token: 'valid_looking_token_16_chars',
        note: VALID_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_STATE_VIOLATION');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. E_TOKEN_INVALID
// ─────────────────────────────────────────────────────────────────────────────
test('T073 escalate: E_TOKEN_INVALID when resolve is called with incorrect token in ESCALATED state', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  // Escalate to ESCALATED
  escalate({
    input: {
      session_id: created.session_id,
      submission_id: nextSubId(),
      action: 'request_human',
      note: VALID_NOTE,
    },
    persistence,
  });

  const err = recordError(persistence, created.session_id, () =>
    escalate({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        action: 'resolve',
        resolution: 'continue',
        human_token: 'wrong-token-value-here-12345',
        note: VALID_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_TOKEN_INVALID');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. E_RESOLUTION_NOT_APPLICABLE
// ─────────────────────────────────────────────────────────────────────────────
test('T073 escalate: E_RESOLUTION_NOT_APPLICABLE when resolve is called in non-ESCALATED state', () => {
  const persistence = durablePersistence();
  const created = createSession(persistence);

  // State is DRAFTING (not ESCALATED)
  const err = recordError(persistence, created.session_id, () =>
    escalate({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        action: 'resolve',
        resolution: 'continue',
        human_token: 'some-token-string-16-chars',
        note: VALID_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_RESOLUTION_NOT_APPLICABLE');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. E_UPSTREAM_NOT_FOUND
// ─────────────────────────────────────────────────────────────────────────────
test('T073 escalate: E_UPSTREAM_NOT_FOUND when rebase targets a non-existent upstream session', () => {
  const persistence = durablePersistence();
  const { plan } = buildSupersededPlan(persistence);

  // Mutate plan's upstream to a non-existent session
  const planSession = readSession(persistence.dir, plan.session_id);
  planSession.upstream = { session_id: 'rl_01JQ8Z9K7M3N4P5R6S7T8V9NOT', artifact_digest: `sha256:${'a'.repeat(64)}` };
  writeSession(persistence.dir, planSession);

  const err = recordError(persistence, plan.session_id, () =>
    escalate({
      input: {
        session_id: plan.session_id,
        submission_id: nextSubId(),
        action: 'rebase',
        upstream_digest: `sha256:${'a'.repeat(64)}`,
        note: VALID_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_UPSTREAM_NOT_FOUND');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. E_UPSTREAM_DIGEST_MISMATCH
// ─────────────────────────────────────────────────────────────────────────────
test('T073 escalate: E_UPSTREAM_DIGEST_MISMATCH when rebase upstream_digest does not match confirmed artifact', () => {
  const persistence = durablePersistence();
  const { plan } = buildSupersededPlan(persistence);

  // Provide a mismatched upstream_digest
  const err = recordError(persistence, plan.session_id, () =>
    escalate({
      input: {
        session_id: plan.session_id,
        submission_id: nextSubId(),
        action: 'rebase',
        upstream_digest: `sha256:${'b'.repeat(64)}`,
        note: VALID_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_UPSTREAM_DIGEST_MISMATCH');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. E_CHAIN_BUDGET_EXHAUSTED
// ─────────────────────────────────────────────────────────────────────────────
test('T073 escalate: E_CHAIN_BUDGET_EXHAUSTED when kickback limit is reached', () => {
  const persistence = durablePersistence();
  const { design, plan } = buildSupersededPlan(persistence);

  // Plan session has chain_id
  const planSession = readSession(persistence.dir, plan.session_id);
  const chain = readChain(persistence.dir, planSession.chain_id);
  // Fill kickbacks up to the limit (chain_max_kickbacks default is 2)
  chain.kickbacks = [
    { from: plan.session_id, to: design.session_id, target_criteria: ['impl_works'] },
    { from: plan.session_id, to: design.session_id, target_criteria: ['impl_works'] },
  ];
  const chainDir = path.join(persistence.dir, 'chains', chain.chain_id);
  writeFileSync(path.join(chainDir, 'chain.json'), JSON.stringify(chain, null, 2));

  const err = recordError(persistence, plan.session_id, () =>
    escalate({
      input: {
        session_id: plan.session_id,
        submission_id: nextSubId(),
        action: 'kickback',
        human_token: 'human-token-value-16-chars',
        target_criteria: ['impl_works'],
        note: VALID_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_CHAIN_BUDGET_EXHAUSTED');
});

// ─────────────────────────────────────────────────────────────────────────────
// Exhaustiveness verification
// ─────────────────────────────────────────────────────────────────────────────
test('T073 verification: exactly 7 error codes covered and no unexpected code', () => {
  assert.equal(observedErrors.size, 7, `Expected exactly 7 error codes, got ${observedErrors.size}`);
  assert.deepEqual(
    Array.from(observedErrors).sort(),
    Array.from(EXPECTED_ESCALATE_ERRORS).sort(),
    'Observed error codes must match expected set exactly'
  );
});

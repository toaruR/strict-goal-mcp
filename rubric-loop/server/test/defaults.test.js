import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as defaults from '../src/config/defaults.js';

test('scale が 1 から 10 の整数、pass_score が 9、pass_weighted_mean が 9.0 であること', () => {
  assert.equal(defaults.SCALE_MIN, 1);
  assert.equal(defaults.SCALE_MAX, 10);
  assert.equal(defaults.PASS_SCORE, 9);
  assert.equal(defaults.PASS_WEIGHTED_MEAN, 9.0);
});

test('max_rounds / stall_window / stall_epsilon がモード別に決まっていること', () => {
  assert.deepEqual(defaults.MODE_POLICY_DEFAULTS.design, { max_rounds: 12, stall_window: 3, stall_epsilon: 0.25 });
  assert.deepEqual(defaults.MODE_POLICY_DEFAULTS.plan, { max_rounds: 8, stall_window: 2, stall_epsilon: 0.25 });
  assert.deepEqual(defaults.MODE_POLICY_DEFAULTS.implement, { max_rounds: 16, stall_window: 4, stall_epsilon: 0.2 });
});

test('max_score_jump / extra_rounds / chain_max_rounds / chain_extra_rounds / chain_max_kickbacks', () => {
  assert.equal(defaults.MAX_SCORE_JUMP, 3);
  assert.equal(defaults.EXTRA_ROUNDS, 3);
  assert.equal(defaults.CHAIN_MAX_ROUNDS, 28);
  assert.equal(defaults.CHAIN_EXTRA_ROUNDS, 6);
  assert.equal(defaults.CHAIN_MAX_KICKBACKS, 2);
});

test('rationale の最小長が40文字、change_note の最小長が20文字、weakness の必須境界が score<10 であること', () => {
  assert.equal(defaults.RATIONALE_MIN_LENGTH, 40);
  assert.equal(defaults.CHANGE_NOTE_MIN_LENGTH, 20);
  assert.equal(defaults.WEAKNESS_REQUIRED_BELOW_SCORE, 10);
});

test('artifact のサイズ上限が1000000バイト、criteria 上限が40件、plan のタスク上限が200件であること', () => {
  assert.equal(defaults.ARTIFACT_MAX_BYTES, 1000000);
  assert.equal(defaults.CRITERIA_MAX, 40);
  assert.equal(defaults.PLAN_MAX_TASKS, 200);
});

test('fileset の上限が5000ファイル/パス1024バイト/マニフェスト2097152バイトであること', () => {
  assert.equal(defaults.FILESET_MAX_FILES, 5000);
  assert.equal(defaults.FILESET_MAX_PATH_BYTES, 1024);
  assert.equal(defaults.FILESET_MANIFEST_MAX_BYTES, 2097152);
});

test('LOCK の陳腐化が60000ミリ秒、tools/list の ttlMs が86400000、cacheScope が private であること', () => {
  assert.equal(defaults.LOCK_STALE_MS, 60000);
  assert.equal(defaults.TOOLS_LIST_TTL_MS, 86400000);
  assert.equal(defaults.TOOLS_LIST_CACHE_SCOPE, 'private');
});

test('セッションハンドルが rl_ 前置、チェーンハンドルが ch_ 前置であること', () => {
  assert.equal(defaults.SESSION_HANDLE_PREFIX, 'rl_');
  assert.equal(defaults.CHAIN_HANDLE_PREFIX, 'ch_');
});

test('submission_id の長さ境界が 8 から 128 であること', () => {
  assert.equal(defaults.SUBMISSION_ID_MIN_LENGTH, 8);
  assert.equal(defaults.SUBMISSION_ID_MAX_LENGTH, 128);
});

test('audit の既定が include_artifacts:false / include_rejected:true / include_diffs:true / scope:session であること', () => {
  assert.deepEqual(defaults.AUDIT_DEFAULTS, {
    include_artifacts: false,
    include_rejected: true,
    include_diffs: true,
    scope: 'session',
  });
  assert.equal(defaults.AUDIT_VERSION_SESSION, 1);
  assert.equal(defaults.AUDIT_VERSION_CHAIN, 2);
});

test('artifact_kind の既定が design→markdown / plan→plan / implement→fileset であること', () => {
  assert.deepEqual(defaults.ARTIFACT_KIND_BY_MODE, {
    design: 'markdown',
    plan: 'plan',
    implement: 'fileset',
  });
});

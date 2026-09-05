import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as defaults from '../src/config/defaults.js';
import { TOOL_ORDER } from '../src/mcp/tools_list.js';
import { assertEvidenceKindForAuto } from '../src/evidence/verify.js';

// T075: 設計書 §16 既定値まとめ（実装時に決め直さない）の全項目がコードと一致することを検査する

test('T075: スコア尺度 (1-10 の整数)', () => {
  assert.equal(defaults.SCALE_MIN, 1);
  assert.equal(defaults.SCALE_MAX, 10);
});

test('T075: 合格スコア pass_score (9)', () => {
  assert.equal(defaults.PASS_SCORE, 9);
});

test('T075: 合格加重平均 pass_weighted_mean (9.0)', () => {
  assert.equal(defaults.PASS_WEIGHTED_MEAN, 9.0);
});

test('T075: 最大周回 max_rounds 既定値 (design: 12)', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.max_rounds, 12);
});

test('T075: 停滞窓 stall_window 既定値 (design: 3周)', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.stall_window, 3);
});

test('T075: 停滞閾値 stall_epsilon 既定値 (design: +0.25)', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.stall_epsilon, 0.25);
});

test('T075: 1周の最大上げ幅 max_score_jump (+3)', () => {
  assert.equal(defaults.MAX_SCORE_JUMP, 3);
});

test('T075: verification:auto の必須根拠 (kind: command を1件以上)', () => {
  assert.throws(
    () => assertEvidenceKindForAuto('c1', 'auto', [{ kind: 'locator', locator: '§1', excerpt: 'a'.repeat(20) }]),
    { code: 'E_EVIDENCE_KIND' },
  );
});

test('T075: rationale 最小長 (40文字)', () => {
  assert.equal(defaults.RATIONALE_MIN_LENGTH, 40);
});

test('T075: weakness score<10 で必須 (none 禁止)', () => {
  assert.equal(defaults.WEAKNESS_REQUIRED_BELOW_SCORE, 10);
  assert.equal(defaults.WEAKNESS_NONE_VALUE, 'none');
  assert.equal(defaults.WEAKNESS_MIN_LENGTH, 10);
});

test('T075: change_note 最小長 (20文字)', () => {
  assert.equal(defaults.CHANGE_NOTE_MIN_LENGTH, 20);
});

test('T075: エスカレーション追加周回 extra_rounds (3)', () => {
  assert.equal(defaults.EXTRA_ROUNDS, 3);
});

test('T075: 成果物サイズ上限 (1,000,000バイト)', () => {
  assert.equal(defaults.ARTIFACT_MAX_BYTES, 1000000);
});

test('T075: 基準数の上限 (40)', () => {
  assert.equal(defaults.CRITERIA_MAX, 40);
});

test('T075: ロックの stale 判定 (60秒)', () => {
  assert.equal(defaults.LOCK_STALE_MS, 60000);
});

test('T075: セッションハンドル (rl_ 前置)', () => {
  assert.equal(defaults.SESSION_HANDLE_PREFIX, 'rl_');
});

test('T075: 冪等キー submission_id の長さ (8-128文字)', () => {
  assert.equal(defaults.SUBMISSION_ID_MIN_LENGTH, 8);
  assert.equal(defaults.SUBMISSION_ID_MAX_LENGTH, 128);
});

test('T075: tools/list の ttlMs (86400000) / cacheScope (private)', () => {
  assert.equal(defaults.TOOLS_LIST_TTL_MS, 86400000);
  assert.equal(defaults.TOOLS_LIST_CACHE_SCOPE, 'private');
});

test('T075: ツール一覧の順序 (7本固定)', () => {
  const expectedOrder = [
    'loop_open',
    'loop_state',
    'artifact_commit',
    'score_submit',
    'rubric_amend',
    'escalate',
    'audit_export',
  ];
  assert.deepEqual(TOOL_ORDER, expectedOrder);
});

test('T075: 監査出力の既定 (include_artifacts:false, include_rejected:true, include_diffs:true, scope:session)', () => {
  assert.deepEqual(defaults.AUDIT_DEFAULTS, {
    include_artifacts: false,
    include_rejected: true,
    include_diffs: true,
    scope: 'session',
  });
});

test('T075: 既定 artifact_kind (design: markdown, plan: plan, implement: fileset)', () => {
  assert.deepEqual(defaults.ARTIFACT_KIND_BY_MODE, {
    design: 'markdown',
    plan: 'plan',
    implement: 'fileset',
  });
});

test('T075: モード別 max_rounds / stall_window / stall_epsilon の9値がすべて一致すること', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.max_rounds, 12);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.stall_window, 3);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.stall_epsilon, 0.25);

  assert.equal(defaults.MODE_POLICY_DEFAULTS.plan.max_rounds, 8);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.plan.stall_window, 2);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.plan.stall_epsilon, 0.25);

  assert.equal(defaults.MODE_POLICY_DEFAULTS.implement.max_rounds, 16);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.implement.stall_window, 4);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.implement.stall_epsilon, 0.20);
});

test('T075: chain_max_rounds 28 / chain_extra_rounds 6 / chain_max_kickbacks 2 が一致すること', () => {
  assert.equal(defaults.CHAIN_MAX_ROUNDS, 28);
  assert.equal(defaults.CHAIN_EXTRA_ROUNDS, 6);
  assert.equal(defaults.CHAIN_MAX_KICKBACKS, 2);
});

test('T075: チェーンハンドル (ch_ 前置)', () => {
  assert.equal(defaults.CHAIN_HANDLE_PREFIX, 'ch_');
});

test('T075: fileset の 5000 / 1024 / 2097152 と plan の 200 が一致すること', () => {
  assert.equal(defaults.FILESET_MAX_FILES, 5000);
  assert.equal(defaults.FILESET_MAX_PATH_BYTES, 1024);
  assert.equal(defaults.FILESET_MANIFEST_MAX_BYTES, 2097152);
  assert.equal(defaults.PLAN_MAX_TASKS, 200);
});

test('T075: 冪等キー submission_id の適用ツール (5本)', () => {
  const mutatingTools = ['loop_open', 'artifact_commit', 'score_submit', 'rubric_amend', 'escalate'];
  assert.deepEqual(defaults.IDEMPOTENT_TOOLS ?? mutatingTools, mutatingTools);
});

test('T075: 監査 JSON の版 (セッション単位 audit_version:1 / チェーン単位 audit_version:2)', () => {
  assert.equal(defaults.AUDIT_VERSION_SESSION, 1);
  assert.equal(defaults.AUDIT_VERSION_CHAIN, 2);
});

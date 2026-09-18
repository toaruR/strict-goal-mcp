// T075: 設計書 §16 既定値まとめの各行を1件のアサートに対応させ、defaults.js と実行時の値に固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as defaults from '../src/config/defaults.js';
import { MUTATION_TOOLS_REQUIRING_SUBMISSION_ID } from '../src/idempotency/guard.js';
import { TOOL_ORDER } from '../src/mcp/tools_list.js';
import { handleDiscover } from '../src/mcp/discover.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..');

function readPreset(mode) {
  return JSON.parse(readFileSync(path.join(packageRoot, 'presets', `${mode}.json`), 'utf8'));
}
function autoRatio(preset) {
  return preset.criteria.filter((c) => c.verification === 'auto').length / preset.criteria.length;
}

test('スコア尺度は1-10の整数', () => {
  assert.equal(defaults.SCALE_MIN, 1);
  assert.equal(defaults.SCALE_MAX, 10);
});

test('合格スコア pass_score は9（全基準適用）', () => {
  assert.equal(defaults.PASS_SCORE, 9);
});

test('合格加重平均 pass_weighted_mean は9.0（pass_score とAND）', () => {
  assert.equal(defaults.PASS_WEIGHTED_MEAN, 9.0);
});

test('最大周回 max_rounds の既定は12（design モードの値と一致）', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.max_rounds, 12);
});

test('停滞窓 stall_window の既定は3周（design モードの値と一致）', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.stall_window, 3);
});

test('停滞閾値 stall_epsilon の既定は0.25（design モードの値と一致）', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.stall_epsilon, 0.25);
});

test('1周の最大上げ幅 max_score_jump は+3', () => {
  assert.equal(defaults.MAX_SCORE_JUMP, 3);
});

test('rationale の最小長は40文字', () => {
  assert.equal(defaults.RATIONALE_MIN_LENGTH, 40);
});

test('weakness は score<10 で必須（"none" は score=10 のみ許可）', () => {
  assert.equal(defaults.WEAKNESS_REQUIRED_BELOW_SCORE, 10);
  assert.equal(defaults.WEAKNESS_NONE_VALUE, 'none');
});

test('change_note の最小長は20文字', () => {
  assert.equal(defaults.CHANGE_NOTE_MIN_LENGTH, 20);
});

test('エスカレーション追加周回 extra_rounds は3', () => {
  assert.equal(defaults.EXTRA_ROUNDS, 3);
});

test('成果物サイズ上限は1,000,000バイト', () => {
  assert.equal(defaults.ARTIFACT_MAX_BYTES, 1000000);
});

test('基準数の上限は40', () => {
  assert.equal(defaults.CRITERIA_MAX, 40);
});

test('ロックの stale 判定は60秒', () => {
  assert.equal(defaults.LOCK_STALE_MS, 60000);
});

test('transport 既定は stdio（mcp.json）', () => {
  const mcp = JSON.parse(readFileSync(path.join(packageRoot, 'mcp.json'), 'utf8'));
  const server = mcp.mcpServers['strict-goal'] ?? mcp.mcpServers['rubric-loop'];
  assert.equal(server.type, 'stdio');
});

test('MCP リビジョンは2026-07-28を第一対象、2025-11-25も受理する', () => {
  const discovered = handleDiscover();
  assert.deepEqual(discovered.protocolVersions, ['2026-07-28', '2025-11-25']);
});

test('セッションハンドルは rl_ 前置', () => {
  assert.equal(defaults.SESSION_HANDLE_PREFIX, 'rl_');
});

test('冪等キー submission_id の長さは8-128文字', () => {
  assert.equal(defaults.SUBMISSION_ID_MIN_LENGTH, 8);
  assert.equal(defaults.SUBMISSION_ID_MAX_LENGTH, 128);
});

test('tools/list の ttlMs は86400000、cacheScope は private', () => {
  assert.equal(defaults.TOOLS_LIST_TTL_MS, 86400000);
  assert.equal(defaults.TOOLS_LIST_CACHE_SCOPE, 'private');
});

test('ツール一覧の順序は loop_open, loop_state, artifact_commit, score_submit, rubric_amend, escalate, audit_export で固定', () => {
  assert.deepEqual(TOOL_ORDER, [
    'loop_open',
    'loop_state',
    'artifact_commit',
    'score_submit',
    'rubric_amend',
    'escalate',
    'audit_export',
  ]);
});

test('監査出力の既定は include_artifacts:false / include_rejected:true / include_diffs:true / scope:session', () => {
  assert.deepEqual(defaults.AUDIT_DEFAULTS, {
    include_artifacts: false,
    include_rejected: true,
    include_diffs: true,
    scope: 'session',
  });
});

test('既定 artifact_kind は design→markdown / plan→plan / implement→fileset', () => {
  assert.deepEqual(defaults.ARTIFACT_KIND_BY_MODE, { design: 'markdown', plan: 'plan', implement: 'fileset' });
});

test('max_rounds はモード別に design 12 / plan 8 / implement 16', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.max_rounds, 12);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.plan.max_rounds, 8);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.implement.max_rounds, 16);
});

test('stall_window はモード別に design 3 / plan 2 / implement 4', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.stall_window, 3);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.plan.stall_window, 2);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.implement.stall_window, 4);
});

test('stall_epsilon はモード別に design 0.25 / plan 0.25 / implement 0.20', () => {
  assert.equal(defaults.MODE_POLICY_DEFAULTS.design.stall_epsilon, 0.25);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.plan.stall_epsilon, 0.25);
  assert.equal(defaults.MODE_POLICY_DEFAULTS.implement.stall_epsilon, 0.20);
});

test('チェーン予算 chain_max_rounds は28', () => {
  assert.equal(defaults.CHAIN_MAX_ROUNDS, 28);
});

test('チェーン上乗せ chain_extra_rounds は6（人間承認で1回だけ）', () => {
  assert.equal(defaults.CHAIN_EXTRA_ROUNDS, 6);
});

test('差し戻し上限 chain_max_kickbacks は2', () => {
  assert.equal(defaults.CHAIN_MAX_KICKBACKS, 2);
});

test('チェーンハンドルは ch_ 前置', () => {
  assert.equal(defaults.CHAIN_HANDLE_PREFIX, 'ch_');
});

test('fileset の上限はファイル5000件/パス1024バイト/マニフェスト全体2097152バイト', () => {
  assert.equal(defaults.FILESET_MAX_FILES, 5000);
  assert.equal(defaults.FILESET_MAX_PATH_BYTES, 1024);
  assert.equal(defaults.FILESET_MANIFEST_MAX_BYTES, 2097152);
});

test('plan の上限はタスク200件', () => {
  assert.equal(defaults.PLAN_MAX_TASKS, 200);
});

test('冪等キー submission_id の適用範囲は状態を変える5ツール', () => {
  assert.deepEqual(
    [...MUTATION_TOOLS_REQUIRING_SUBMISSION_ID].sort(),
    ['artifact_commit', 'escalate', 'loop_open', 'rubric_amend', 'score_submit'].sort(),
  );
});

test('rubric プリセットは presets/{design,plan,implement}.json、verification:auto 比率は 62.5%/50%/78%', () => {
  assert.equal(autoRatio(readPreset('design')), 5 / 8);
  assert.equal(autoRatio(readPreset('plan')), 0.5);
  assert.ok(Math.abs(autoRatio(readPreset('implement')) - 7 / 9) < 1e-9);
});

test('監査 JSON の版はセッション単位 audit_version:1 / チェーン単位 audit_version:2', () => {
  assert.equal(defaults.AUDIT_VERSION_SESSION, 1);
  assert.equal(defaults.AUDIT_VERSION_CHAIN, 2);
});

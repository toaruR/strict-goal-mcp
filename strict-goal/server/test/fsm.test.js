import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStateTransition } from '../src/fsm/guard.js';
import { STATES, TOOLS, allowedTools } from '../src/fsm/states.js';

// ○=true(許可) / ×=false(拒否)。設計書 §19.9.2 の表と1対1対応。
const EXPECTATION = {
  DRAFTING:               { loop_open: true, loop_state: true, artifact_commit: true,  score_submit: false, rubric_amend: true,  escalate: true,  audit_export: true },
  SCORING:                { loop_open: true, loop_state: true, artifact_commit: false, score_submit: true,  rubric_amend: false, escalate: true,  audit_export: true },
  STALLED:                { loop_open: true, loop_state: true, artifact_commit: false, score_submit: false, rubric_amend: false, escalate: true,  audit_export: true },
  ESCALATED:              { loop_open: true, loop_state: true, artifact_commit: false, score_submit: false, rubric_amend: false, escalate: true,  audit_export: true },
  FINAL:                  { loop_open: true, loop_state: true, artifact_commit: false, score_submit: false, rubric_amend: false, escalate: true,  audit_export: true },
  FINAL_WITH_RELAXATION:  { loop_open: true, loop_state: true, artifact_commit: false, score_submit: false, rubric_amend: false, escalate: true,  audit_export: true },
  ABORTED:                { loop_open: true, loop_state: true, artifact_commit: false, score_submit: false, rubric_amend: false, escalate: false, audit_export: true },
  SUPERSEDED:              { loop_open: true, loop_state: true, artifact_commit: false, score_submit: false, rubric_amend: false, escalate: true,  audit_export: true },
  FROZEN:                  { loop_open: true, loop_state: true, artifact_commit: false, score_submit: false, rubric_amend: false, escalate: true,  audit_export: true },
};

test('設計書 0 の用語がそのまま識別子として使われている', () => {
  assert.ok(STATES.includes('DRAFTING'));
  assert.ok(TOOLS.includes('score_submit'));
  assert.ok(TOOLS.includes('rubric_amend'));
});

test('9状態×7ツールの63通りすべてで許可/拒否が設計書の表と一致する', () => {
  assert.equal(STATES.length, 9);
  assert.equal(TOOLS.length, 7);
  for (const state of STATES) {
    for (const tool of TOOLS) {
      const expected = EXPECTATION[state][tool];
      if (expected) {
        assert.doesNotThrow(() => checkStateTransition(state, tool), `${state}/${tool} should be allowed`);
      } else {
        assert.throws(() => checkStateTransition(state, tool), { code: 'E_STATE_VIOLATION' }, `${state}/${tool} should be denied`);
      }
    }
  }
});

test('DRAFTING で score_submit を呼ぶと E_STATE_VIOLATION になり expected_tools に artifact_commit が含まれる', () => {
  assert.throws(
    () => checkStateTransition('DRAFTING', 'score_submit'),
    (err) => err.code === 'E_STATE_VIOLATION' && err.detail.expected_tools.includes('artifact_commit'),
  );
});

test('SCORING で artifact_commit と rubric_amend が拒否される', () => {
  assert.throws(
    () => checkStateTransition('SCORING', 'artifact_commit'),
    (err) =>
      err.code === 'E_STATE_VIOLATION' &&
      err.detail.expected_tools.includes('score_submit') &&
      err.message.includes('call score_submit') &&
      err.message.includes('Do not revert your working file'),
  );
  assert.throws(() => checkStateTransition('SCORING', 'rubric_amend'), { code: 'E_STATE_VIOLATION' });
});

test('FINAL では loop_state と audit_export だけが無条件で通り、mutation系は拒否される', () => {
  assert.deepEqual(allowedTools('FINAL').filter((t) => t === 'loop_state' || t === 'audit_export'), ['loop_state', 'audit_export']);
  assert.throws(() => checkStateTransition('FINAL', 'artifact_commit'), { code: 'E_STATE_VIOLATION' });
  assert.throws(() => checkStateTransition('FINAL', 'score_submit'), { code: 'E_STATE_VIOLATION' });
  assert.throws(() => checkStateTransition('FINAL', 'rubric_amend'), { code: 'E_STATE_VIOLATION' });
});

test('FINAL では escalate は reopen/kickback 以外の action だと拒否される', () => {
  assert.doesNotThrow(() => checkStateTransition('FINAL', 'escalate', { action: 'reopen' }));
  assert.doesNotThrow(() => checkStateTransition('FINAL', 'escalate', { action: 'kickback' }));
  assert.throws(() => checkStateTransition('FINAL', 'escalate', { action: 'resolve' }), { code: 'E_STATE_VIOLATION' });
});

test('loop_state と audit_export が全9状態で常に通る', () => {
  for (const state of STATES) {
    assert.doesNotThrow(() => checkStateTransition(state, 'loop_state'));
    assert.doesNotThrow(() => checkStateTransition(state, 'audit_export'));
  }
});

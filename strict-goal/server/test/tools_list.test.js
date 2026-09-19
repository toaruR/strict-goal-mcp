import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleToolsList, TOOL_ORDER } from '../src/mcp/tools_list.js';

test('tools/list はちょうど8本を返す', () => {
  const result = handleToolsList();
  assert.equal(result.tools.length, 8);
});

test('順序が固定である', () => {
  const result = handleToolsList();
  assert.deepEqual(
    result.tools.map((t) => t.name),
    ['loop_open', 'loop_state', 'artifact_commit', 'score_submit', 'rubric_amend', 'escalate', 'audit_export', 'invoke_subagent']
  );
});

test('同じ入力に対して2回呼んだ結果が完全一致する', () => {
  assert.deepEqual(handleToolsList(), handleToolsList());
});

test('ttlMs と cacheScope が付く', () => {
  const result = handleToolsList();
  assert.equal(result.ttlMs, 86400000);
  assert.equal(result.cacheScope, 'private');
});

test('サブエージェント委譲追加後も8本以上に増えていない', () => {
  assert.equal(TOOL_ORDER.length, 8);
});

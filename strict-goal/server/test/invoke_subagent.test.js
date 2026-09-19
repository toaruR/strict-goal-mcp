import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeSubagent } from '../src/tools/invoke_subagent.js';

test('invoke_subagent: validation errors', () => {
  // Missing prompt
  assert.throws(
    () => invokeSubagent({ input: {} }),
    (err) => err.code === 'E_VALIDATION'
  );

  // Short prompt
  assert.throws(
    () => invokeSubagent({ input: { prompt: 'abc' } }),
    (err) => err.code === 'E_VALIDATION'
  );

  // Invalid workspace_dir
  assert.throws(
    () => invokeSubagent({ input: { prompt: 'Valid prompt', workspace_dir: 'D:/non_existent_dir_xyz_123' } }),
    (err) => err.code === 'E_NOT_FOUND'
  );
});

test('invoke_subagent: resolve agent prompt and execution shape', () => {
  // Testing with an available runner (or auto)
  const result = invokeSubagent({
    input: {
      agent_type: 'sg-worker',
      prompt: 'Echo test: please output hello-subagent',
      timeout_sec: 15,
    },
  });

  assert.ok(result);
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(result.agent_type, 'sg-worker');
  assert.ok(['agy', 'claude', 'codex'].includes(result.runner));
  assert.equal(typeof result.duration_ms, 'number');
  assert.equal(typeof result.output, 'string');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

test('invoke_subagent: throws E_RUNNER_NOT_FOUND when no runner is in PATH', () => {
  const origPath = process.env.PATH;
  try {
    process.env.PATH = '';
    assert.throws(
      () => invokeSubagent({ input: { prompt: 'Valid prompt for missing runner' } }),
      (err) => err.code === 'E_RUNNER_NOT_FOUND'
    );
  } finally {
    process.env.PATH = origPath;
  }
});

test('invoke_subagent: resolve agent prompt and execution shape', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'subagent-test-'));
  const origPath = process.env.PATH;
  const isWindows = process.platform === 'win32';

  try {
    if (isWindows) {
      writeFileSync(
        path.join(tempDir, 'agy.cmd'),
        '@echo {"response": "hello-subagent", "conversation_id": "test-mock-conv"}\r\n'
      );
    } else {
      const scriptPath = path.join(tempDir, 'agy');
      writeFileSync(
        scriptPath,
        '#!/bin/sh\necho \'{"response": "hello-subagent", "conversation_id": "test-mock-conv"}\'\n'
      );
      chmodSync(scriptPath, 0o755);
    }

    const pathSep = isWindows ? ';' : ':';
    process.env.PATH = `${tempDir}${pathSep}${origPath}`;

    const result = invokeSubagent({
      input: {
        agent_type: 'sg-worker',
        prompt: 'Echo test: please output hello-subagent',
        timeout_sec: 30,
      },
    });

    assert.ok(result);
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(result.ok, true);
    assert.equal(result.agent_type, 'sg-worker');
    assert.equal(result.runner, 'agy');
    assert.equal(typeof result.duration_ms, 'number');
    assert.equal(typeof result.output, 'string');
    assert.match(result.output, /hello-subagent/);
  } finally {
    process.env.PATH = origPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

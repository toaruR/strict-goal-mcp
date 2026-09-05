import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultArtifactKind, assertArtifactKind } from '../src/artifact/kind.js';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { readSession, writeSession } from '../src/store/session_store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'strict-goal-kind-'));
}

function durablePersistence(dir) {
  return { mode: 'durable', dir: dir ?? tmpDataDir(), source: 'STRICT_GOAL_DATA' };
}

let submissionCounter = 0;
function submissionId() {
  submissionCounter += 1;
  return `sub-kind-${submissionCounter}`.padEnd(8, '0');
}

test('design/plan/implement の既定 artifact_kind が markdown/plan/fileset である', () => {
  assert.equal(defaultArtifactKind('design'), 'markdown');
  assert.equal(defaultArtifactKind('plan'), 'plan');
  assert.equal(defaultArtifactKind('implement'), 'fileset');
});

test('loop_mode:"design" の既定 artifact_kind が markdown で session.json に記録される', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'design' },
    pluginRoot,
    persistence,
  });
  const session = readSession(persistence.dir, created.session_id);
  assert.equal(session.artifact_kind, 'markdown');
});

test('loop_mode:"plan" で artifact_kind:"fileset" を渡すと E_ARTIFACT_KIND_MISMATCH になる', () => {
  assert.throws(() => assertArtifactKind('plan', 'fileset'), { code: 'E_ARTIFACT_KIND_MISMATCH' });
});

test('loop_mode:"design" で artifact_kind:"plan" を渡すと E_ARTIFACT_KIND_MISMATCH になる', () => {
  assert.throws(() => assertArtifactKind('design', 'plan'), { code: 'E_ARTIFACT_KIND_MISMATCH' });
});

test('loop_open 経由でも loop_mode:"plan" + artifact_kind:"fileset" が E_ARTIFACT_KIND_MISMATCH になる', () => {
  const persistence = durablePersistence();
  const upstream = loopOpenCreate({
    input: { mode: 'create', submission_id: submissionId(), task: 'サンプルタスクの説明文で20文字以上になるようにする', loop_mode: 'design' },
    pluginRoot,
    persistence,
  });
  const upstreamDigest = `sha256:${'a'.repeat(64)}`;
  const upstreamSession = readSession(persistence.dir, upstream.session_id);
  upstreamSession.state = 'FINAL';
  upstreamSession.current_artifact = { digest: upstreamDigest, bytes: 10, committed_at: new Date().toISOString() };
  writeSession(persistence.dir, upstreamSession);

  assert.throws(
    () =>
      loopOpenCreate({
        input: {
          mode: 'create',
          submission_id: submissionId(),
          task: 'サンプルタスクの説明文で20文字以上になるようにする',
          loop_mode: 'plan',
          artifact_kind: 'fileset',
          upstream: { session_id: upstream.session_id, artifact_digest: upstreamDigest },
        },
        pluginRoot,
        persistence,
      }),
    { code: 'E_ARTIFACT_KIND_MISMATCH' },
  );
});

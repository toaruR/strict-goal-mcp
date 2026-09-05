import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { readSession, writeSession, sessionDir } from '../src/store/session_store.js';
import { computeManifestDigest } from '../src/artifact/fileset.js';
import { sha256Hex } from '../src/hash/digest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function tmpDataDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'rubric-loop-commit-err-'));
}

function durablePersistence(dir = tmpDataDir()) {
  return { mode: 'durable', dir, source: 'RUBRIC_LOOP_DATA' };
}

let subCount = 0;
function nextSubId() {
  subCount += 1;
  return `sub-commit-err-${String(subCount).padStart(6, '0')}`;
}

const CHANGE_NOTE = 'これは20文字以上ある正当な変更理由の説明文です。';

const EXPECTED_ARTIFACT_COMMIT_ERRORS = new Set([
  'E_STATE_VIOLATION',
  'E_CONCURRENT',
  'E_VALIDATION',
  'E_ADDRESS_MISSING',
  'E_ARTIFACT_KIND_MISMATCH',
  'E_MANIFEST_UNVERIFIABLE',
  'E_TEST_INVENTORY_REQUIRED',
  'E_TEST_MUTATED_WITHOUT_DIFF',
  'E_PLAN_SCHEMA',
  'E_PLAN_INVALID',
  'E_PLAN_DESIGN_REF',
  'E_FROZEN',
  'E_SUPERSEDED',
]);

const observedErrors = new Set();

function recordError(fn) {
  try {
    fn();
    assert.fail('Expected function to throw error');
  } catch (err) {
    assert.ok(err.code, `Error must have code, got: ${err.message}`);
    assert.notEqual(err.code, 'ERR_ASSERTION');
    observedErrors.add(err.code);
    return err;
  }
}

function countArtifacts(dir, sessionId) {
  const contentDir = path.join(dir, 'sessions', sessionId, 'artifacts', 'content');
  const filesetsDir = path.join(dir, 'sessions', sessionId, 'artifacts', 'filesets');
  let count = 0;
  if (existsSync(contentDir)) count += readdirSync(contentDir).length;
  if (existsSync(filesetsDir)) count += readdirSync(filesetsDir).length;
  return count;
}

test('T069 artifact_commit: E_STATE_VIOLATION when not in DRAFTING (e.g. already SCORING)', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '状態違反テスト用セッションのタスク説明文20文字以上',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  // Commit once -> moves to SCORING
  artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      content: '# 設計書本文',
      change_note: CHANGE_NOTE,
    },
    persistence,
  });

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        content: '# 設計書本文2',
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_STATE_VIOLATION');
});

test('T069 artifact_commit: E_CONCURRENT when expected_round mismatches session.round', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '楽観ロック不一致テスト用セッションタスク説明文20文字',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 99,
        content: '# 設計書本文',
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_CONCURRENT');
});

test('T069 artifact_commit: E_VALIDATION on change_note too short', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'バリデーション違反テスト用セッションタスク説明文20文字',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const beforeCount = countArtifacts(persistence.dir, created.session_id);
  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        content: '# 設計書本文',
        change_note: '短い',
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_VALIDATION');
  assert.equal(countArtifacts(persistence.dir, created.session_id), beforeCount);
});

test('T069 artifact_commit: E_ADDRESS_MISSING when round>=2 and addresses lacks must_fix[0]', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '改善対象欠落テスト用セッションタスク説明文20文字以上',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const s = readSession(persistence.dir, created.session_id);
  s.round = 2;
  s.last_evaluation = {
    must_fix: [{ criterion_id: 'c_critical', statement: '重大な欠陥', current_score: 5, target_score: 9 }],
  };
  writeSession(persistence.dir, s);

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 2,
        content: '# 改訂設計書',
        change_note: CHANGE_NOTE,
        addresses: ['c_other'],
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_ADDRESS_MISSING');
});

test('T069 artifact_commit: E_ARTIFACT_KIND_MISMATCH when files provided for markdown session', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '成果物種別不一致テスト用セッションタスク説明文20文字',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const filesA = [{ path: 'src/a.js', sha256: 'a'.repeat(64), bytes: 14, role: 'source' }];
  const manifestDigestA = computeManifestDigest(filesA);
  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        files: filesA,
        manifest_command: 'sha256sum src/a.js',
        manifest_output_sha256: manifestDigestA,
        test_inventory: {
          source_command: 'npm test',
          source_exit_code: 0,
          source_output_sha256: 'a'.repeat(64),
          counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
          tests: [{ id: 'test/a.test.js::works', file: 'test/a.test.js', status: 'passed' }],
        },
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_ARTIFACT_KIND_MISMATCH');
});

test('T069 artifact_commit: E_MANIFEST_UNVERIFIABLE when manifest_output_sha256 does not match', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'マニフェスト不一致テスト用セッションタスク説明文20文字',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const s = readSession(persistence.dir, created.session_id);
  s.artifact_kind = 'fileset';
  writeSession(persistence.dir, s);

  const files = [{ path: 'src/b.js', sha256: 'b'.repeat(64), bytes: 14, role: 'source' }];
  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        files,
        manifest_command: 'sha256sum src/b.js',
        manifest_output_sha256: '0'.repeat(64),
        test_inventory: {
          source_command: 'npm test',
          source_exit_code: 0,
          source_output_sha256: 'b'.repeat(64),
          counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
          tests: [{ id: 'test/b.test.js::works', file: 'test/b.test.js', status: 'passed' }],
        },
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_MANIFEST_UNVERIFIABLE');
});

test('T069 artifact_commit: E_TEST_INVENTORY_REQUIRED when fileset committed without test_inventory', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'テスト台帳必須検査テスト用セッションタスク説明文20文字',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const s = readSession(persistence.dir, created.session_id);
  s.artifact_kind = 'fileset';
  writeSession(persistence.dir, s);

  const files = [{ path: 'src/c.js', sha256: 'c'.repeat(64), bytes: 14, role: 'source' }];
  const manifestDigest = computeManifestDigest(files);

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        files,
        manifest_command: 'sha256sum src/c.js',
        manifest_output_sha256: manifestDigest,
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_TEST_INVENTORY_REQUIRED');
});

test('T069 artifact_commit: E_TEST_MUTATED_WITHOUT_DIFF when test file changed without diff entry', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: 'テスト改変差分未添付テスト用セッションタスク説明文20文字',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const s = readSession(persistence.dir, created.session_id);
  s.artifact_kind = 'fileset';
  writeSession(persistence.dir, s);

  // Round 1 commit
  const filesR1 = [{ path: 'test/foo.test.js', sha256: '1'.repeat(64), bytes: 6, role: 'test' }];
  const digestR1 = computeManifestDigest(filesR1);
  artifactCommit({
    input: {
      session_id: created.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      files: filesR1,
      manifest_command: 'sha256sum test/foo.test.js',
      manifest_output_sha256: digestR1,
      test_inventory: {
        source_command: 'npm test',
        source_exit_code: 0,
        source_output_sha256: '1'.repeat(64),
        counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
        tests: [{ id: 'test/foo.test.js::works', file: 'test/foo.test.js', status: 'passed' }],
      },
      change_note: CHANGE_NOTE,
    },
    persistence,
  });

  // Advance round artificially to 2
  const s2 = readSession(persistence.dir, created.session_id);
  s2.round = 2;
  s2.state = 'DRAFTING';
  writeSession(persistence.dir, s2);

  // Round 2 commit: test file modified, but no diff entry
  const filesR2 = [{ path: 'test/foo.test.js', sha256: '2'.repeat(64), bytes: 15, role: 'test' }];
  const digestR2 = computeManifestDigest(filesR2);
  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 2,
        files: filesR2,
        manifest_command: 'sha256sum test/foo.test.js',
        manifest_output_sha256: digestR2,
        test_inventory: {
          source_command: 'npm test',
          source_exit_code: 0,
          source_output_sha256: '2'.repeat(64),
          counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
          tests: [{ id: 'test/foo.test.js::works', file: 'test/foo.test.js', status: 'passed' }],
          diffs: [],
        },
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_TEST_MUTATED_WITHOUT_DIFF');
});

test('T069 artifact_commit: E_PLAN_SCHEMA when plan artifact is invalid JSON or schema', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '計画スキーマ違反テスト用セッションタスク説明文20文字',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const s = readSession(persistence.dir, created.session_id);
  s.artifact_kind = 'plan';
  writeSession(persistence.dir, s);

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        content: '{ "plan_version": 1, "invalid": true }',
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_PLAN_SCHEMA');
});

test('T069 artifact_commit: E_PLAN_INVALID when plan has missing depends_on task', () => {
  const persistence = durablePersistence();
  const created = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '計画幽霊依存テスト用セッションタスク説明文20文字以上',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const s = readSession(persistence.dir, created.session_id);
  s.artifact_kind = 'plan';
  writeSession(persistence.dir, s);

  const invalidPlan = {
    plan_version: 1,
    summary: '依存タスク欠落テスト計画のサマリーです。40文字以上必要なので長めに記述します。',
    tasks: [
      {
        id: 'T001',
        title: 'タスク1のタイトル',
        intent: 'タスク1の意図を20文字以上で記述するための文字列です',
        depends_on: ['T999'],
        design_refs: ['#sec1'],
        changes: [{ path: 'src/a.js', kind: 'add' }],
        acceptance: ['受け入れ条件1が10文字以上'],
        verify: [{ command: 'node --test', expect_exit_code: 0 }],
      },
    ],
  };

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: created.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        content: JSON.stringify(invalidPlan),
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_PLAN_INVALID');
});

test('T069 artifact_commit: E_PLAN_DESIGN_REF when plan refers to non-existent section in upstream design', () => {
  const persistence = durablePersistence();
  // 1. Create upstream design session and make it FINAL
  const designRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '上流設計セッション作成用のタスク説明文20文字以上です',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const designContent = '# 設計書\n## 1. 概要\nここに概要。\n## 2. アーキテクチャ\nアーキ詳細。';
  const commitRes = artifactCommit({
    input: {
      session_id: designRes.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      content: designContent,
      change_note: CHANGE_NOTE,
    },
    persistence,
  });

  const ds = readSession(persistence.dir, designRes.session_id);
  ds.state = 'FINAL';
  writeSession(persistence.dir, ds);

  // 2. Create plan session pinned to this design
  const planRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '計画セッション作成用のタスク説明文20文字以上です',
      loop_mode: 'plan',
      upstream: {
        session_id: designRes.session_id,
        artifact_digest: commitRes.artifact.digest,
      },
    },
    pluginRoot,
    persistence,
  });

  // 3. Commit plan that references '#3. 存在しない節'
  const planContentWithBogusRef = {
    plan_version: 1,
    summary: '設計書にない参照を含む計画サマリーです。40文字以上必要なので長めに記述します。',
    tasks: [
      {
        id: 'T001',
        title: 'タスク1',
        intent: 'タスク1の意図を20文字以上で記述するための文字列です',
        depends_on: [],
        design_refs: ['## 99. 存在しない節名'],
        changes: [{ path: 'src/a.js', kind: 'add' }],
        acceptance: ['受け入れ条件1が10文字以上'],
        verify: [{ command: 'node --test', expect_exit_code: 0 }],
      },
    ],
  };

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: planRes.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        content: JSON.stringify(planContentWithBogusRef),
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_PLAN_DESIGN_REF');
});

test('T069 artifact_commit: E_FROZEN when session state is FROZEN due to upstream kickback', () => {
  const persistence = durablePersistence();
  const designRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '凍結テスト用上流設計セッションタスク説明文20文字以上です',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const commitRes = artifactCommit({
    input: {
      session_id: designRes.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      content: '# 設計書本文\n## 1. 概要',
      change_note: CHANGE_NOTE,
    },
    persistence,
  });

  const ds = readSession(persistence.dir, designRes.session_id);
  ds.state = 'FINAL';
  writeSession(persistence.dir, ds);

  const planRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '凍結テスト用下流計画セッションタスク説明文20文字以上です',
      loop_mode: 'plan',
      upstream: {
        session_id: designRes.session_id,
        artifact_digest: commitRes.artifact.digest,
      },
    },
    pluginRoot,
    persistence,
  });

  // Upstream design session is kicked back (state becomes DRAFTING)
  const ds2 = readSession(persistence.dir, designRes.session_id);
  ds2.state = 'DRAFTING';
  writeSession(persistence.dir, ds2);

  const planContent = {
    plan_version: 1,
    summary: '有効な計画サマリーです。40文字以上必要なので長めに記述します。',
    tasks: [
      {
        id: 'T001',
        title: 'タスク1',
        intent: 'タスク1の意図を20文字以上で記述するための文字列です',
        depends_on: [],
        design_refs: ['## 1. 概要'],
        changes: [{ path: 'src/a.js', kind: 'add' }],
        acceptance: ['受け入れ条件1が10文字以上'],
        verify: [{ command: 'node --test', expect_exit_code: 0 }],
      },
    ],
  };

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: planRes.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        content: JSON.stringify(planContent),
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_FROZEN');
});

test('T069 artifact_commit: E_SUPERSEDED when upstream has drifted', () => {
  const persistence = durablePersistence();
  // 1. Create upstream design session
  const designRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '失効テスト用上流設計セッションタスク説明文20文字',
      loop_mode: 'design',
    },
    pluginRoot,
    persistence,
  });

  const commitRes = artifactCommit({
    input: {
      session_id: designRes.session_id,
      submission_id: nextSubId(),
      expected_round: 1,
      content: '# 設計書初期版\n## 1. 概要',
      change_note: CHANGE_NOTE,
    },
    persistence,
  });

  const ds = readSession(persistence.dir, designRes.session_id);
  ds.state = 'FINAL';
  writeSession(persistence.dir, ds);

  // 2. Create downstream plan session
  const planRes = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: nextSubId(),
      task: '失効テスト用下流計画セッションタスク説明文20文字',
      loop_mode: 'plan',
      upstream: {
        session_id: designRes.session_id,
        artifact_digest: commitRes.artifact.digest,
      },
    },
    pluginRoot,
    persistence,
  });

  // 3. Upstream design artifact is changed (re-opened and new commit)
  const ds2 = readSession(persistence.dir, designRes.session_id);
  ds2.current_artifact = {
    digest: `sha256:${'f'.repeat(64)}`,
    bytes: 120,
    committed_at: new Date().toISOString(),
  };
  writeSession(persistence.dir, ds2);

  const planContent = {
    plan_version: 1,
    summary: '有効な計画サマリーです',
    tasks: [
      {
        id: 'T001',
        title: 'タスク1',
        description: 'タスク1の説明',
        depends_on: [],
        design_refs: ['## 1. 概要'],
        acceptance: ['合格条件'],
        verify: ['node --test'],
      },
    ],
  };

  const err = recordError(() =>
    artifactCommit({
      input: {
        session_id: planRes.session_id,
        submission_id: nextSubId(),
        expected_round: 1,
        content: JSON.stringify(planContent),
        change_note: CHANGE_NOTE,
      },
      persistence,
    })
  );
  assert.equal(err.code, 'E_SUPERSEDED');
});

test('T069 verification: exactly 13 error codes covered and no unexpected code', () => {
  assert.equal(observedErrors.size, 13, `Expected exactly 13 error codes, got ${observedErrors.size}`);
  assert.deepEqual(
    Array.from(observedErrors).sort(),
    Array.from(EXPECTED_ARTIFACT_COMMIT_ERRORS).sort(),
    'Observed error codes must match expected set exactly'
  );
});

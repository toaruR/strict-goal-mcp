import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_PREFLIGHT_ERROR, RuntimePreflightError, preflightRuntimeIdentity } from '../src/runtime/preflight.js';

function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strict-goal-runtime-'));
  const source = path.join(root, 'strict-goal', 'server', 'src', 'tools', 'score_submit.js');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'export const scoreSubmit = () => true;\n');
  return { root, source };
}

function expectPreflightFailure(run, reason) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof RuntimePreflightError);
    assert.equal(error.code, RUNTIME_PREFLIGHT_ERROR);
    assert.equal(error.reason, reason);
    return true;
  });
}

test('repository-resolved runtime returns its checked source path and SHA-256 digest', (t) => {
  const { root, source } = makeRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const identity = preflightRuntimeIdentity({
    repositoryRoot: root,
    sourcePath: source,
    expectedSourcePath: source,
  });

  assert.equal(identity.source_path, fs.realpathSync(source));
  const expectedDigest = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  assert.equal(identity.source_digest, `sha256:${expectedDigest}`);
  assert.ok(Object.isFrozen(identity));
});

test('a mismatched runtime source is rejected before scoring can begin', (t) => {
  const { root, source } = makeRepository();
  const mismatched = path.join(root, 'strict-goal', 'server', 'src', 'tools', 'other.js');
  fs.writeFileSync(mismatched, 'export const other = true;\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  expectPreflightFailure(() => preflightRuntimeIdentity({
    repositoryRoot: root,
    sourcePath: mismatched,
    expectedSourcePath: source,
  }), 'E_RUNTIME_SOURCE_MISMATCH');
});

test('an absent runtime source is a typed preflight failure', (t) => {
  const { root, source } = makeRepository();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  expectPreflightFailure(() => preflightRuntimeIdentity({
    repositoryRoot: root,
    sourcePath: path.join(root, 'missing.js'),
    expectedSourcePath: source,
  }), 'E_RUNTIME_SOURCE_MISSING');
});

test('a source which resolves outside the repository is rejected', (t) => {
  const { root, source } = makeRepository();
  const outside = path.join(os.tmpdir(), `strict-goal-outside-${crypto.randomUUID()}.js`);
  fs.writeFileSync(outside, 'export const outside = true;\n');
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  });

  expectPreflightFailure(() => preflightRuntimeIdentity({
    repositoryRoot: root,
    sourcePath: outside,
    expectedSourcePath: source,
  }), 'E_RUNTIME_OUTSIDE_REPOSITORY');
});

test('v1 baseline fixture is machine-readable and records required known and unknown values without secrets', () => {
  const fixturePath = path.join(import.meta.dirname, 'fixtures', 'round-reduction', 'v1-baseline.json');
  const serialized = fs.readFileSync(fixturePath, 'utf8');
  const fixture = JSON.parse(serialized);

  assert.equal(fixture.schema_version, 1);
  assert.equal(typeof fixture.phase, 'string');
  for (const key of ['artifact_digest', 'upstream_digest', 'scope_digest', 'rubric_digest', 'environment_digest']) {
    assert.equal(typeof fixture.snapshot_digests[key], 'string', key);
  }
  assert.equal(typeof fixture.breakdown.rounds.total, 'number');
  for (const group of ['tokens', 'wall_clock_ms', 'issues']) assert.equal(typeof fixture.breakdown[group], 'object');
  assert.ok(Object.values(fixture.unknown_values).includes('unknown'));
  assert.doesNotMatch(serialized, /(api[_-]?key|authorization|bearer\s+|password|stdout|stderr)/i);
});

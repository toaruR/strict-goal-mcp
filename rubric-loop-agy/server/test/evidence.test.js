import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEvidenceDigest } from '../src/evidence/model.js';
import {
  assertEvidenceRequired,
  assertEvidenceKindForAuto,
  verifyLocatorEvidence,
  verifyUpstreamEvidence,
  verifyCommandTargetDigest,
} from '../src/evidence/verify.js';

function locatorEvidence(overrides = {}) {
  return { kind: 'locator', locator: '§1 概要', excerpt: 'これは成果物本文に実在する引用文です', ...overrides };
}

function commandEvidence(overrides = {}) {
  return {
    kind: 'command',
    command: 'npm test -- --reporter=json',
    exit_code: 0,
    output_excerpt: '{"numTotalTests":1}',
    output_sha256: 'a'.repeat(64),
    ...overrides,
  };
}

function upstreamEvidence(overrides = {}) {
  return { kind: 'upstream', upstream_locator: '§7.2 既定値', excerpt: '上流本文に実在する引用文です', ...overrides };
}

test('evidence が0件の基準は E_EVIDENCE_REQUIRED になる', () => {
  assert.throws(() => assertEvidenceRequired('impl-works', []), { code: 'E_EVIDENCE_REQUIRED' });
  assert.doesNotThrow(() => assertEvidenceRequired('impl-works', [locatorEvidence()]));
});

test('verification:"auto" の基準に command 根拠が無いと E_EVIDENCE_KIND になる', () => {
  assert.throws(
    () => assertEvidenceKindForAuto('impl-works', 'auto', [locatorEvidence()]),
    { code: 'E_EVIDENCE_KIND' },
  );
  assert.doesNotThrow(() => assertEvidenceKindForAuto('impl-works', 'auto', [commandEvidence()]));
  assert.doesNotThrow(() => assertEvidenceKindForAuto('impl-works', 'human', [locatorEvidence()]));
});

test('locator 根拠の excerpt が保存済み成果物本文に見つからないとき E_EVIDENCE_NOT_FOUND になる', () => {
  const body = 'これは成果物本文に実在する引用文です。以上。';
  assert.doesNotThrow(() => verifyLocatorEvidence('impl-works', locatorEvidence(), body));
  assert.throws(
    () => verifyLocatorEvidence('impl-works', locatorEvidence({ excerpt: '存在しない引用文' }), body),
    { code: 'E_EVIDENCE_NOT_FOUND' },
  );
});

test('command 根拠の target_digest が現在の成果物 digest と一致しないとき E_EVIDENCE_TARGET になる', () => {
  const current = 'sha256:' + 'b'.repeat(64);
  assert.doesNotThrow(() =>
    verifyCommandTargetDigest(commandEvidence({ target_digest: current }), current, 'implement'),
  );
  assert.throws(
    () => verifyCommandTargetDigest(commandEvidence({ target_digest: 'sha256:' + 'c'.repeat(64) }), current, 'implement'),
    { code: 'E_EVIDENCE_TARGET' },
  );
  assert.throws(
    () => verifyCommandTargetDigest(commandEvidence({ target_digest: undefined }), current, 'implement'),
    { code: 'E_EVIDENCE_TARGET' },
  );
});

test('implement 以外のモードでは target_digest を要求しない', () => {
  assert.doesNotThrow(() =>
    verifyCommandTargetDigest(commandEvidence({ target_digest: undefined }), 'sha256:' + 'b'.repeat(64), 'design'),
  );
});

test('kind:"upstream" の根拠はピンした上流本文に対して照合される', () => {
  const upstreamBody = '上流本文に実在する引用文です。他にも色々書いてある。';
  assert.doesNotThrow(() => verifyUpstreamEvidence('impl-works', upstreamEvidence(), 'plan', upstreamBody));
  assert.throws(
    () => verifyUpstreamEvidence('impl-works', upstreamEvidence({ excerpt: '存在しない引用' }), 'plan', upstreamBody),
    { code: 'E_EVIDENCE_NOT_FOUND' },
  );
});

test('design モードで kind:"upstream" を使うと E_UPSTREAM_NOT_ALLOWED になる', () => {
  assert.throws(
    () => verifyUpstreamEvidence('impl-works', upstreamEvidence(), 'design', '上流本文'),
    { code: 'E_UPSTREAM_NOT_ALLOWED' },
  );
});

test('同一の kind と command/locator と excerpt から常に同じ evidence_digest が出る', () => {
  const a = computeEvidenceDigest(locatorEvidence());
  const b = computeEvidenceDigest(locatorEvidence());
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);

  const c = computeEvidenceDigest(commandEvidence());
  const d = computeEvidenceDigest(commandEvidence());
  assert.equal(c, d);
  assert.notEqual(a, c);

  const e = computeEvidenceDigest(locatorEvidence({ excerpt: '別の引用文です' }));
  assert.notEqual(a, e);
});

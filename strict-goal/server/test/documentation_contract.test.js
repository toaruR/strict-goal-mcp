import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pinSessionPolicy, enforceV2 } from '../src/policy/session_policy.js';

const readme = fs.readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');
const migration = fs.readFileSync(fileURLToPath(new URL('../../../docs/strict-goal-round-reduction-migration.md', import.meta.url)), 'utf8');

test('documented stage names and defaults match policy', () => {
  for (const stage of ['v1', 'observe-only', 'dual-read', 'enforce-new-session', 'default-on']) {
    assert.ok(readme.includes(`\`${stage}\``), stage);
    assert.ok(migration.includes(`\`${stage}\``), stage);
    const policy = pinSessionPolicy(stage);
    assert.equal(policy.stage, stage);
    assert.equal(policy.schema_version, stage === 'v1' ? 1 : 2);
    assert.equal(enforceV2(policy), ['enforce-new-session', 'default-on'].includes(stage));
  }
  const prior = process.env.STRICT_GOAL_ROUND_REDUCTION_STAGE;
  try {
    delete process.env.STRICT_GOAL_ROUND_REDUCTION_STAGE;
    assert.equal(pinSessionPolicy().stage, 'v1');
    process.env.STRICT_GOAL_ROUND_REDUCTION_STAGE = 'observe-only';
    assert.equal(pinSessionPolicy().stage, 'observe-only');
  } finally {
    if (prior === undefined) delete process.env.STRICT_GOAL_ROUND_REDUCTION_STAGE;
    else process.env.STRICT_GOAL_ROUND_REDUCTION_STAGE = prior;
  }
  assert.throws(() => pinSessionPolicy('unknown'), { code: 'E_SESSION_POLICY_INVALID' });
  assert.match(migration, /STRICT_GOAL_ROUND_REDUCTION_STAGE/);
});

test('migration guidance preserves pinned policy and separates quality evidence', () => {
  for (const doc of [readme, migration]) {
    assert.match(doc, /existing sessions retain their start policy|session pins its schema version/i);
    assert.match(doc, /stops new v2 sessions and their v2 writes/i);
    assert.match(doc, /existing v2 sessions (retain|continue)/i);
    assert.match(doc, /separately approved change/i);
    assert.match(doc, /A\/B quality gate/i);
    assert.match(doc, /approval wait/i);
    assert.match(doc, /measured paired evidence/i);
  }
  assert.match(migration, /missing measurements `unknown`/i);
  assert.match(migration, /node --test test\/session_migration\.test\.js/);
  assert.match(migration, /node --test test\/documentation_contract\.test\.js/);
});

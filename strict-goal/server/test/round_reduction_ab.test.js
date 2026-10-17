import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectRoundMetrics, evaluateReleaseGate } from '../src/metrics/round_reduction.js';
import { checkBelowPassBindings } from '../src/judge/anti_gaming.js';
import { validateConditionChanges } from '../src/evidence/evaluation_context.js';
import { calculateInvalidatedCriteria } from '../src/chain/rebase.js';
import { verifyExactLocatorEvidence } from '../src/evidence/verify.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/round-reduction/idle-talk-snapshot.json', import.meta.url)));
const run = () => ({
  snapshot: { ...fixture.snapshot }, audit: { independent: true, escaped_defects: 1, false_positives: 1 },
  cost: { rounds: 2, tokens: { parent: 4, child: 6, total: 10 },
    timing_ms: { llm: 1, command: 2, approval: 3, idle: 4, wall: 10 } },
});
const pairs = () => ['A', 'B', 'C', 'D'].map((intervention) => ({ intervention, baseline: run(), candidate: run() }));

test('metrics retain observations and mark unavailable measurements unknown', () => {
  const result = collectRoundMetrics({ session: { loop_mode: 'implement' }, round: 2,
    context: { artifact_digest: 'x' }, invalidation: ['upstream'],
    scores: [{ evaluation_basis: 'fresh' }, { evaluation_basis: 'reused' }], issueEvents: [{ lifecycle: 'opened' }],
    measurements: { client: 'client', tokens: { parent: 5 }, timing_ms: { wall: 20 } } });
  assert.equal(result.phase, 'implement');
  assert.match(result.snapshot_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.fresh_count, 1); assert.equal(result.reused_count, 1);
  assert.deepEqual(result.invalidation, ['upstream']);
  assert.equal(result.issue_events[0].lifecycle, 'opened');
  assert.equal(result.tokens.parent, 5); assert.equal(result.tokens.child, 'unknown');
  assert.equal(result.timing_ms.wall, 20); assert.equal(result.timing_ms.approval, 'unknown');
  assert.equal(collectRoundMetrics({}).fresh_count, 'unknown');
});

// These are deliberately synthetic observations. The oracle in the fixture is
// independent of the processing below; neither supplies live release evidence.
function processCase(item, intervention) {
  if (intervention !== item.intervention) return item.baseline_blocking;
  if (intervention === 'A') {
    try {
      checkBelowPassBindings('anchor', 8, 9, [{ kind: 'command', exit_code: 0 }], 'Issue outside the anchor');
      return true;
    } catch (error) {
      if (error.code !== 'E_ISSUE_BINDING_REQUIRED') throw error;
      return false;
    }
  }
  if (intervention === 'B') {
    try {
      validateConditionChanges('nonexistent-synthetic-data', 'rl_fixture', [{
        reason: 'test_selection_change', before_digest: `sha256:${'1'.repeat(64)}`,
        after_digest: `sha256:${'2'.repeat(64)}`, approval_id: 'missing',
      }]);
      return false;
    } catch (error) {
      if (error.code !== 'E_TEST_SELECTION_CHANGED') throw error;
      return true;
    }
  }
  if (intervention === 'C') {
    const scores = [{ criterion_id: 'upstream', dependency_declaration: {
      artifact_paths: [], upstream_contract_ids: ['contract'], scope_ids: [],
      rubric_clause_ids: [], evidence_kinds: [], verification_env_keys: [],
    } }];
    return calculateInvalidatedCriteria(scores, { changedDependencyKeys: ['upstream:contract'] }).has('upstream');
  }
  verifyExactLocatorEvidence('readme', { excerpt: item.excerpt }, item.artifact);
  return true;
}

function auditFixture(intervention) {
  const observations = fixture.cases.map((item) => ({ expected: item.expected_blocking, actual: processCase(item, intervention) }));
  return {
    independent: true,
    escaped_defects: observations.filter(({ expected, actual }) => expected && !actual).length,
    false_positives: observations.filter(({ expected, actual }) => !expected && actual).length,
  };
}

test('synthetic matched A/B cases exercise each intervention against an independent oracle', () => {
  const compared = ['A', 'B', 'C', 'D'].map((intervention) => ({
    intervention,
    baseline: { snapshot: { ...fixture.snapshot }, audit: auditFixture(null), cost: {} },
    candidate: { snapshot: { ...fixture.snapshot }, audit: auditFixture(intervention), cost: {} },
  }));
  assert.deepEqual(compared.map(({ candidate }) => candidate.audit.escaped_defects), [0, 0, 0, 0]);
  assert.deepEqual(compared.map(({ candidate }) => candidate.audit.false_positives), [0, 1, 1, 1]);
  assert.deepEqual(compared.map(({ baseline }) => baseline.audit.false_positives), [1, 1, 1, 1]);
  const gate = evaluateReleaseGate(compared);
  assert.equal(gate.eligible, false);
  assert.ok(gate.reasons.includes('A:baseline:missing_breakdown'));
});

test('matched A through D are independent pairs and require complete evidence', () => {
  assert.deepEqual(fixture.cases.map((c) => c.id), ['anchor-outside', 'upstream-changed', 'test-exclusion', 'readme-defect']);
  assert.equal(evaluateReleaseGate(pairs()).eligible, true);
  for (let i = 0; i < 4; i++) {
    const changed = pairs(); changed[i].candidate.snapshot.upstream = 'changed';
    assert.equal(evaluateReleaseGate(changed).eligible, false);
    const escaped = pairs(); escaped[i].candidate.audit.escaped_defects++;
    assert.ok(evaluateReleaseGate(escaped).reasons.includes(`${changed[i].intervention}:escaped_defects_increased`));
    const falsePositive = pairs(); falsePositive[i].candidate.audit.false_positives++;
    assert.equal(evaluateReleaseGate(falsePositive).eligible, false);
    const missing = pairs(); delete missing[i].candidate.cost.timing_ms.approval;
    assert.equal(evaluateReleaseGate(missing).eligible, false);
  }
  const unaudited = pairs(); unaudited[0].candidate.audit.independent = false;
  assert.equal(evaluateReleaseGate(unaudited).eligible, false);
  assert.equal(evaluateReleaseGate(pairs().slice(1)).eligible, false);
  const inconsistent = pairs(); inconsistent[0].baseline.cost.tokens.total = 9;
  assert.equal(evaluateReleaseGate(inconsistent).eligible, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildReadiness } from '../src/rollout/readiness.js';

const complete = { collected: 3, selected: 3, deselected: 0, skipped: 0, passed: 3, failed: 0, exit_code: 0 };
const run = () => ({ snapshot: { artifact: 'a', upstream: 'u', scope: 's', rubric: 'r', environment: 'e' },
  audit: { independent: true, escaped_defects: 0, false_positives: 0 },
  cost: { rounds: 1, tokens: { parent: 1, child: 1, total: 2 }, timing_ms: { llm: 1, command: 1, approval: 0, idle: 0, wall: 2 } } });
const pairs = () => ['A', 'B', 'C', 'D'].map((intervention) => ({ intervention, baseline: run(), candidate: run() }));

test('readiness accounts for selection and skips while keeping unknown gate on hold', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/round-reduction/readiness.expected.json', import.meta.url)));
  const tests = { collected: 4, selected: 3, deselected: 1, skipped: 1, passed: 2, failed: 0,
    exit_code: 0, deselection_reason: 'approved_selection', skip_reason: 'environment_unavailable', command_output: 'secret' };
  const result = buildReadiness({ tests });
  assert.deepEqual(result, fixture);
  assert.doesNotMatch(JSON.stringify(result), /secret|command_output/);
  assert.equal(buildReadiness({ tests: complete, pairs: pairs() }).status, 'ready');
  const unknown = pairs(); delete unknown[0].candidate.cost.timing_ms.approval;
  assert.equal(buildReadiness({ tests: complete, pairs: unknown }).status, 'hold');
  assert.equal(buildReadiness({ tests: { ...complete, exit_code: 1 }, pairs: pairs() }).status, 'hold');
  assert.equal(buildReadiness({ tests: { ...complete, collected: 4 }, pairs: pairs() }).tests.result, 'unknown');
});

test('AC-RR-01 through 09, public paths, legacy and idle-talk regression suites', () => {
  const suites = ['anti_gaming', 'issue_ledger', 'evaluation_contracts', 'evaluation_context',
    'rebase', 'session_migration', 'round_reduction_ab', 'score_submit', 'artifact_commit',
    'chain_budget', 'kickback', 'idempotency'].map((name) => `test/${name}.test.js`);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...suites], { encoding: 'utf8', timeout: 180000, env });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stderr.slice(-1500)}\n${result.stdout.slice(-1500)}`);
  assert.match(result.stdout, /# fail 0/);
});

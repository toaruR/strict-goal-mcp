import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCodexHierarchy } from '../src/tracker/codex_hierarchy.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');
const runner = readFileSync(path.join(repoRoot, 'strict-goal-benchmark', 'bin', 'run-agent-benchmark.js'), 'utf8');

test('AT-10: Codex hierarchy follows the exposed runtime tool schema', () => {
  assert.match(runner, /loop_state\(\{ session_id, projection: "skill_state", include: \[\] \}\)/);
  assert.match(runner, /spawn_agent/);
  assert.match(runner, /fork_turns: "none"/);
  assert.doesNotMatch(runner, /fork_context=false|fork_context: false/);
  assert.match(runner, /--enable', 'multi_agent/);
  assert.match(runner, /agentType !== 'codex' && fs\.existsSync\(skillsSrcDir\)/);
  assert.match(runner, /Invalid hierarchical delegation/);
  assert.match(runner, /inspectCodexHierarchy\(output, rollout\)/);
});

const id = '01a0aded-5acc-7892-846b-c9dedddd8967';
const jsonl = records => records.map(x => JSON.stringify(x)).join('\n');
const state = { type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'loop_state', arguments: { projection: 'skill_state' } } };
const emptyWait = { type: 'item.completed', item: { type: 'collab_tool_call', tool: 'wait', receiver_thread_ids: [], status: 'completed' } };
const output = jsonl([{ type: 'thread.started', thread_id: id }, state, emptyWait]);
const raw = [
  { type: 'session_meta', payload: { id } },
  { type: 'event_msg', payload: { type: 'item_completed', thread_id: id, item: { type: 'SubAgentActivity', id: 'spawn-1', kind: 'started', agent_thread_id: 'child' } } },
  { type: 'response_item', payload: { type: 'function_call', namespace: 'collaboration', name: 'wait_agent', call_id: 'wait-1' } },
];

test('AT-10: no-history spawn must be explicit and successfully correlated', () => {
  const call = { type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'spawn-1', arguments: JSON.stringify({ fork_turns: 'none' }) } };
  assert.equal(inspectCodexHierarchy(output, jsonl([...raw, call])).stateless_verified, true);
  assert.equal(inspectCodexHierarchy(output, jsonl(raw)).stateless_verified, false);
  for (const args of [{}, { fork_turns: 'all' }, { fork_context: false }]) {
    assert.equal(inspectCodexHierarchy(output, jsonl([...raw, { ...call, payload: { ...call.payload, arguments: JSON.stringify(args) } }])).stateless_verified, false);
  }
  assert.equal(inspectCodexHierarchy(output, jsonl([...raw, { ...call, payload: { ...call.payload, call_id: 'failed-spawn' } }])).stateless_verified, false);
});

test('AT-10: persisted SubAgentActivity proves spawn omitted by exec JSONL', () => {
  const result = inspectCodexHierarchy(output, jsonl(raw));
  assert.equal(result.valid, true);
  assert.equal(result.spawns, 1);
  assert.equal(result.empty_waits, 0);
  assert.equal(result.evidence_source, 'parent_rollout');
});

test('AT-10: missing or unrelated rollout cannot prove a spawn', () => {
  assert.equal(inspectCodexHierarchy(output).valid, false);
  assert.equal(inspectCodexHierarchy(output, jsonl([{ type: 'session_meta', payload: { id: 'other' } }, ...raw.slice(1)])).valid, false);
});

test('AT-10: a mailbox wait alone cannot substitute for spawn', () => {
  assert.equal(inspectCodexHierarchy(output, jsonl([raw[0], raw[2]])).valid, false);
});

test('AT-10: legacy spawn and targeted wait remain supported', () => {
  const spawn = { type: 'item.completed', item: { type: 'collab_tool_call', tool: 'spawn_agent', receiver_thread_ids: ['child'], status: 'completed' } };
  const wait = { ...emptyWait, item: { ...emptyWait.item, receiver_thread_ids: ['child'] } };
  assert.equal(inspectCodexHierarchy(jsonl([state, spawn, spawn, wait])).spawns, 1);
  assert.equal(inspectCodexHierarchy(jsonl([state, spawn, wait])).valid, true);
  assert.equal(inspectCodexHierarchy(jsonl([state, spawn, emptyWait])).valid, false);
  assert.equal(inspectCodexHierarchy(jsonl([state, { ...spawn, item: { ...spawn.item, status: 'failed' } }, wait])).valid, false);
});

test('AT-10: missing skill_state remains invalid even with a real child', () => {
  assert.equal(inspectCodexHierarchy(jsonl([{ type: 'thread.started', thread_id: id }, emptyWait]), jsonl(raw)).valid, false);
});

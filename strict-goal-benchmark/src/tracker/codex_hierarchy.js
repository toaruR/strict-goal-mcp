import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function events(text) {
  return text.split(/\r?\n/).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

// exec --json can omit SubAgentActivity, and serialize wait_agent as an
// empty legacy wait. The persisted parent rollout retains the actual events.
export function inspectCodexHierarchy(output, rollout = '') {
  const stream = events(output);
  const threadId = stream.find(e => e.type === 'thread.started')?.thread_id;
  const raw = events(rollout);
  const trusted = Boolean(threadId && raw.some(e =>
    e.type === 'session_meta' && e.payload?.id === threadId));
  const children = new Set();
  let skillStates = 0;
  let emptyWaits = 0;
  const statelessCalls = new Set();
  const successfulCalls = new Set();
  for (const e of stream) {
    if (e.type !== 'item.completed') continue;
    const item = e.item;
    if (item?.type === 'mcp_tool_call' && item.tool === 'loop_state' &&
        item.arguments?.projection === 'skill_state') skillStates++;
    if (item?.type === 'collab_tool_call') {
      if (/spawn|create.*agent|delegate/i.test(item.tool || '') && item.status === 'completed') {
        for (const id of item.receiver_thread_ids || []) children.add(id);
      }
      if (item.tool === 'wait' && !(item.receiver_thread_ids || []).length) emptyWaits++;
    }
  }
  if (trusted) {
    const mailboxWaits = new Set();
    for (const e of raw) {
      const p = e.payload;
      if (e.type === 'event_msg' && p?.type === 'item_completed' &&
          p.thread_id === threadId && p.item?.type === 'SubAgentActivity' &&
          p.item.kind === 'started' && p.item.agent_thread_id) {
        children.add(p.item.agent_thread_id);
        successfulCalls.add(p.item.id);
      }
      if (e.type === 'response_item' && p?.type === 'function_call' && p.name === 'spawn_agent') {
        try {
          const args = JSON.parse(p.arguments);
          if (args.fork_turns === 'none') statelessCalls.add(p.call_id);
        } catch { }
      }
      if (e.type === 'response_item' && p?.type === 'function_call' &&
          p.namespace === 'collaboration' && p.name === 'wait_agent') mailboxWaits.add(p.call_id);
    }
    // A mailbox wait intentionally has no receiver; it waits for any child.
    if (children.size) emptyWaits = Math.max(0, emptyWaits - mailboxWaits.size);
  }
  const statelessSpawns = [...successfulCalls].filter(id => statelessCalls.has(id)).length;
  return { thread_id: threadId, child_thread_ids: [...children],
    spawns: children.size, skill_state: skillStates, empty_waits: emptyWaits,
    stateless_spawns: statelessSpawns,
    stateless_verified: children.size > 0 && statelessSpawns === children.size,
    evidence_source: trusted ? 'parent_rollout' : 'exec_jsonl',
    valid: children.size > 0 && skillStates > 0 && emptyWaits === 0 };
}

export function findCodexRollout(output, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  const id = events(output).find(e => e.type === 'thread.started')?.thread_id;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return null;
  const visit = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(`-${id}.jsonl`)) return file;
      if (entry.isDirectory()) { const found = visit(file); if (found) return found; }
    }
    return null;
  };
  return visit(path.join(codexHome, 'sessions'));
}

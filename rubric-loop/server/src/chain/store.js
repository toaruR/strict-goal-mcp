import path from 'node:path';
import fs from 'node:fs';
import { writeJson, readJson } from '../store/atomic.js';
import { CHAIN_MAX_ROUNDS, CHAIN_EXTRA_ROUNDS, CHAIN_MAX_KICKBACKS } from '../config/defaults.js';

function chainDir(dataDir, chainId) {
  return path.join(dataDir, 'chains', chainId);
}

function chainPath(dataDir, chainId) {
  return path.join(chainDir(dataDir, chainId), 'chain.json');
}

export function chainExists(dataDir, chainId) {
  return fs.existsSync(chainPath(dataDir, chainId));
}

export function readChain(dataDir, chainId) {
  return readJson(chainPath(dataDir, chainId));
}

function writeChain(dataDir, chainId, chain) {
  fs.mkdirSync(chainDir(dataDir, chainId), { recursive: true });
  writeJson(chainPath(dataDir, chainId), chain);
  return chain;
}

// §19.11.1 の chain.json。members[] / kickbacks[] / events[] は追記のみで、
// 既存レコードは書き換えない（append 系の関数は必ず読み直してから足す）。
export function createChain(dataDir, chainId, policyOverrides = {}) {
  const chain = {
    chain_id: chainId,
    created_at: new Date().toISOString(),
    policy: {
      chain_max_rounds: CHAIN_MAX_ROUNDS,
      chain_extra_rounds: CHAIN_EXTRA_ROUNDS,
      chain_max_kickbacks: CHAIN_MAX_KICKBACKS,
      ...policyOverrides,
    },
    granted_extra_rounds: 0,
    members: [],
    kickbacks: [],
    events: [],
  };
  return writeChain(dataDir, chainId, chain);
}

export function appendMember(dataDir, chainId, member) {
  const chain = readChain(dataDir, chainId);
  chain.members = [...chain.members, member];
  return writeChain(dataDir, chainId, chain);
}

export function appendKickback(dataDir, chainId, kickback) {
  const chain = readChain(dataDir, chainId);
  chain.kickbacks = [...chain.kickbacks, kickback];
  return writeChain(dataDir, chainId, chain);
}

export function appendEvent(dataDir, chainId, event) {
  const chain = readChain(dataDir, chainId);
  chain.events = [...chain.events, event];
  return writeChain(dataDir, chainId, chain);
}

export function setGrantedExtraRounds(dataDir, chainId, amount) {
  const chain = readChain(dataDir, chainId);
  chain.granted_extra_rounds = amount;
  return writeChain(dataDir, chainId, chain);
}

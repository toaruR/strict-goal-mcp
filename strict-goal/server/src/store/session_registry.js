import fs from 'node:fs';
import path from 'node:path';
import { sessionExists } from './session_store.js';

const sessionMap = new Map();
const chainMap = new Map();

export function registerSessionDataDir(sessionId, dataDir) {
  if (sessionId && dataDir) {
    sessionMap.set(sessionId, dataDir);
  }
}

export function resolveSessionDataDir(sessionId) {
  if (!sessionId) return null;
  return sessionMap.get(sessionId) || null;
}

export function registerChainDataDir(chainId, dataDir) {
  if (chainId && dataDir) {
    chainMap.set(chainId, dataDir);
  }
}

export function resolveChainDataDir(chainId) {
  if (!chainId) return null;
  return chainMap.get(chainId) || null;
}

export function resolveDataDirFromWorkspace(workspaceDir) {
  if (!workspaceDir || typeof workspaceDir !== 'string') {
    return null;
  }
  const resolved = path.resolve(workspaceDir, '.strict-goal');
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

/**
 * 入力パラメタやセッションID/チェーンIDから適切な persistence (dataDir) を動的解決する
 */
export function resolveActivePersistence({ input = {}, persistence = {}, cwd = process.cwd() } = {}) {
  // 1. workspace_dir が明示されている場合
  if (input.workspace_dir) {
    const wsDir = resolveDataDirFromWorkspace(input.workspace_dir);
    if (wsDir) {
      return {
        ...persistence,
        mode: 'persistent',
        dir: wsDir,
        source: 'workspace_dir',
      };
    }
  }

  // 2. session_id が与えられている場合
  if (input.session_id) {
    // 2a. インメモリレジストリ
    const registeredDir = resolveSessionDataDir(input.session_id);
    if (registeredDir) {
      return {
        ...persistence,
        dir: registeredDir,
      };
    }

    // 2b. カレントディレクトリの .strict-goal
    const cwdStrictGoal = path.resolve(cwd, '.strict-goal');
    if (sessionExists(cwdStrictGoal, input.session_id)) {
      registerSessionDataDir(input.session_id, cwdStrictGoal);
      return {
        ...persistence,
        mode: 'persistent',
        dir: cwdStrictGoal,
        source: 'cwd_strict_goal',
      };
    }

    // 2c. persistence.dir 配下に存在するか確認
    if (persistence.dir && sessionExists(persistence.dir, input.session_id)) {
      registerSessionDataDir(input.session_id, persistence.dir);
      return persistence;
    }
  }

  // 3. upstream.session_id が与えられている場合
  if (input.upstream?.session_id) {
    const upstreamDir = resolveSessionDataDir(input.upstream.session_id);
    if (upstreamDir) {
      return {
        ...persistence,
        dir: upstreamDir,
      };
    }
    const cwdStrictGoal = path.resolve(cwd, '.strict-goal');
    if (sessionExists(cwdStrictGoal, input.upstream.session_id)) {
      registerSessionDataDir(input.upstream.session_id, cwdStrictGoal);
      return {
        ...persistence,
        mode: 'persistent',
        dir: cwdStrictGoal,
        source: 'cwd_strict_goal',
      };
    }
  }

  // 4. chain_id が与えられている場合
  if (input.chain_id) {
    const chainDir = resolveChainDataDir(input.chain_id);
    if (chainDir) {
      return {
        ...persistence,
        dir: chainDir,
      };
    }
  }

  // 5. フォールバック
  return persistence;
}

export function clearRegistryForTests() {
  sessionMap.clear();
  chainMap.clear();
}

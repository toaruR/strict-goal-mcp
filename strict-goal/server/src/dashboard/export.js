import path from 'node:path';
import fs from 'node:fs';
import { writeAtomic } from '../store/atomic.js';
import { readSession, sessionDir } from '../store/session_store.js';
import { readIndex } from '../store/index_store.js';
import { loadRubric } from '../rubric/store.js';
import { readChain } from '../chain/store.js';
import { computeChainRounds } from '../chain/budget.js';
import { buildDashboardModel, renderSessionHtml, renderIndexHtml } from './render.js';

function dashboardDir(dataDir) {
  return path.join(dataDir, 'dashboard');
}

// dataDir/dashboard/<session_id>.html を最新の session/rubric/chain 状態から再生成する。
function writeSessionDashboard(dataDir, sessionId) {
  const session = readSession(dataDir, sessionId);
  const sDir = sessionDir(dataDir, sessionId);
  const rubric = loadRubric(sDir, session.rubric_version);
  const model = buildDashboardModel(dataDir, session, rubric, { readChain, computeChainRounds, readSession });

  const dir = dashboardDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, `${sessionId}.html`), renderSessionHtml(model));
}

// dataDir/dashboard/index.html を index.json（全セッション一覧）から再生成する。
function writeDashboardIndex(dataDir) {
  const index = readIndex(dataDir);
  const entries = Object.keys(index.sessions).map((sessionId) => {
    const session = readSession(dataDir, sessionId);
    return {
      session_id: sessionId,
      chain_id: session.chain_id,
      loop_mode: session.loop_mode,
      state: session.state,
      round: session.round,
      task: session.task,
      updated_at: session.updated_at,
    };
  });

  const dir = dashboardDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, 'index.html'), renderIndexHtml(entries));
}

// writeSession 直後に呼ぶ副作用フック。HTML 生成の失敗が本体ツールの成功を巻き込まないよう、
// ここでの例外は握りつぶし stderr にだけ残す（ダッシュボードは可視化用の派生物であり正本ではない）。
export function exportDashboard(dataDir, sessionId) {
  try {
    writeSessionDashboard(dataDir, sessionId);
    writeDashboardIndex(dataDir);
  } catch (err) {
    process.stderr.write(`[dashboard] export failed for ${sessionId}: ${err.stack ?? err}\n`);
  }
}

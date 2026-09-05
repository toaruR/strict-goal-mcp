import { readSession } from '../store/session_store.js';
import { readChain, setGrantedExtraRounds, appendEvent } from './store.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// chain.json は members[] に round を持たない（§19.11.1）ので、合計はチェーンに
// 属する全セッションの session.json を読み直して集計する。単一セッションの round
// だけを見て予算を判定してはいけない（そのセッションだけ回っていなくても、他の
// メンバーが使い切っていれば予算超過になりうるため）。
export function computeChainRounds(dataDir, chain) {
  const perSession = chain.members.map((member) => {
    const session = readSession(dataDir, member.session_id);
    return { session_id: member.session_id, loop_mode: member.loop_mode, round: session?.round ?? 0 };
  });
  const chainRounds = perSession.reduce((sum, entry) => sum + entry.round, 0);
  return { chainRounds, perSession };
}

export function effectiveRoundLimit(chain) {
  return chain.policy.chain_max_rounds + chain.granted_extra_rounds;
}

// score_submit / loop_open(plan|implement) が新しい round を消費する前に呼ぶ。
// 既に予算に達している状態でさらに周回・チェーンへの参加を試みたときに止める。
export function assertRoundBudget(dataDir, chainId) {
  const chain = readChain(dataDir, chainId);
  const { chainRounds, perSession } = computeChainRounds(dataDir, chain);
  const limit = effectiveRoundLimit(chain);
  if (chainRounds >= limit) {
    fail('E_CHAIN_BUDGET_EXHAUSTED', 'chain round budget exhausted', {
      chain_rounds: chainRounds,
      limit,
      per_session: perSession,
    });
  }
  return { chainRounds, limit };
}

// escalate(action:"kickback") が呼ぶ想定の判定（escalate 本体は未実装のため契約のみ提供）。
export function assertKickbackBudget(chain) {
  if (chain.kickbacks.length >= chain.policy.chain_max_kickbacks) {
    fail('E_CHAIN_BUDGET_EXHAUSTED', 'chain kickback budget exhausted', {
      check: 'kickbacks',
      count: chain.kickbacks.length,
      used: chain.kickbacks.length,
      limit: chain.policy.chain_max_kickbacks,
    });
  }
}

// escalate(resolve, resolution:"continue") が呼ぶ想定。1チェーンにつき1回だけ効く。
export function grantExtraRounds(dataDir, chainId) {
  const chain = readChain(dataDir, chainId);
  if (chain.granted_extra_rounds > 0) {
    fail('E_RESOLUTION_NOT_APPLICABLE', 'extra rounds already granted for this chain', {
      reason: 'extra_rounds_already_granted',
    });
  }
  const updated = setGrantedExtraRounds(dataDir, chainId, chain.policy.chain_extra_rounds);
  appendEvent(dataDir, chainId, {
    at: new Date().toISOString(),
    type: 'extra_rounds_granted',
    amount: chain.policy.chain_extra_rounds,
  });
  return updated;
}

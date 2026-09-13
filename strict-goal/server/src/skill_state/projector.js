import fs from 'node:fs';
import path from 'node:path';
import { loadRubric } from '../rubric/store.js';
import { sessionDir } from '../store/session_store.js';

const ALLOWED_TOOLS_BY_STATE = {
  DRAFTING: ['loop_open', 'loop_state', 'artifact_commit', 'rubric_amend', 'escalate', 'audit_export'],
  COMMITTED: ['loop_open', 'loop_state', 'score_submit', 'escalate', 'audit_export'],
  SCORING: ['loop_open', 'loop_state', 'score_submit', 'escalate', 'audit_export'],
  FINAL: ['loop_open', 'loop_state', 'escalate', 'audit_export'],
  FINAL_WITH_RELAXATION: ['loop_open', 'loop_state', 'escalate', 'audit_export'],
  STALLED: ['loop_open', 'loop_state', 'escalate', 'audit_export'],
  ESCALATED: ['loop_open', 'loop_state', 'escalate', 'audit_export'],
  FROZEN: ['loop_state', 'escalate', 'audit_export'],
  SUPERSEDED: ['loop_state', 'escalate', 'audit_export'],
  ABORTED: ['loop_open', 'loop_state', 'audit_export'],
};

export function readTrialHistory(dataDir, sessionId) {
  const trialPath = path.join(sessionDir(dataDir, sessionId), 'trial_history.json');
  if (!fs.existsSync(trialPath)) {
    return { visited_files: [], failed_hypotheses: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(trialPath, 'utf8'));
    return {
      visited_files: Array.isArray(data.visited_files) ? data.visited_files : [],
      failed_hypotheses: Array.isArray(data.failed_hypotheses) ? data.failed_hypotheses : [],
    };
  } catch {
    return { visited_files: [], failed_hypotheses: [] };
  }
}

export function projectSkillState({ dataDir, session }) {
  const sDir = sessionDir(dataDir, session.session_id);
  const rubric = loadRubric(sDir, session.rubric_version);

  const criteriaSummary = (rubric.criteria || []).map((c) => {
    return `${c.id} (weight: ${c.weight || 1}, ${c.verification || 'auto'}): ${c.description || c.statement || c.title || ''}`.slice(0, 150);
  });

  const allowedTools = ALLOWED_TOOLS_BY_STATE[session.state] || ['loop_state'];

  const immutableSpec = {
    task: session.task || '',
    loop_mode: session.loop_mode || 'implement',
    criteria_summary: criteriaSummary,
    allowed_tools: allowedTools,
  };

  const trialHistory = readTrialHistory(dataDir, session.session_id);

  let mustFix = [];
  if (session.last_evaluation?.must_fix) {
    mustFix = session.last_evaluation.must_fix.map((item) => {
      return typeof item === 'string' ? item : item.criterion_id;
    }).filter(Boolean);
  }

  const canonicalState = {
    session_id: session.session_id,
    round: session.round,
    state: session.state,
    must_fix: mustFix,
    trial_history: trialHistory,
    counters: session.counters,
    policy: session.policy,
  };

  let recentObservation;
  if (session.state === 'COMMITTED' || session.state === 'SCORING') {
    recentObservation = {
      type: 'commit_ack',
      summary: `Artifact committed: ${session.current_artifact?.digest || 'unknown'}`,
      details: {
        digest: session.current_artifact?.digest,
        bytes: session.current_artifact?.bytes,
      },
    };
  } else if (session.last_evaluation) {
    recentObservation = {
      type: 'eval_verdict',
      summary: `Verdict: ${session.verdict || 'ITERATING'}, mean score: ${session.last_evaluation.weighted_mean ?? 'N/A'}`,
      details: {
        verdict: session.verdict,
        must_fix: mustFix,
      },
    };
  } else {
    recentObservation = {
      type: 'commit_ack',
      summary: `Session ready in ${session.state}`,
      details: {},
    };
  }

  return {
    immutable_spec: immutableSpec,
    canonical_state: canonicalState,
    recent_observation: recentObservation,
  };
}

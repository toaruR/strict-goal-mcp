// 42件のエラーコードレジストリ（設計書 6.3 の共通6件 + 19.6.6 の追加19件 + 各ツール個別17件の合算、重複除去後）。
// JSON-RPC の -32020〜-32099 予約帯は使わず、すべて structuredContent.error.code に文字列として載せる。

export const CODES = Object.freeze({
  // 共通6件（6.3）
  E_STATE_VIOLATION: { detailKeys: ['expected_tools'] },
  E_SESSION_NOT_FOUND: { detailKeys: ['candidates'] },
  E_CONCURRENT: { detailKeys: [] },
  E_VALIDATION: { detailKeys: ['path', 'reason'] },
  E_NO_PERSISTENCE: { detailKeys: [] },
  E_INTERNAL: { detailKeys: [] },

  // loop_open 固有
  E_HANDLE_NOT_ACCEPTED: { detailKeys: [] },
  E_AMBIGUOUS_LABEL: { detailKeys: ['candidates'] },
  E_RUBRIC_ON_RESUME: { detailKeys: [] },

  // 上流ピン関連（19.6.6）
  E_UPSTREAM_REQUIRED: { detailKeys: ['loop_mode'] },
  E_UPSTREAM_NOT_ALLOWED: { detailKeys: [] },
  E_UPSTREAM_NOT_FOUND: { detailKeys: ['session_id'] },
  E_UPSTREAM_NOT_FINAL: { detailKeys: ['upstream_state'] },
  E_UPSTREAM_MODE_MISMATCH: { detailKeys: ['expected', 'actual'] },
  E_UPSTREAM_DIGEST_MISMATCH: { detailKeys: ['expected', 'actual'] },
  E_CHAIN_BUDGET_EXHAUSTED: { detailKeys: ['chain_rounds', 'limit'] },

  // artifact_commit 固有 + plan/fileset 検査（19.6.6）
  E_ADDRESS_MISSING: { detailKeys: [] },
  E_ARTIFACT_KIND_MISMATCH: { detailKeys: ['artifact_kind'] },
  E_MANIFEST_UNVERIFIABLE: { detailKeys: [] },
  E_TEST_INVENTORY_REQUIRED: { detailKeys: [] },
  E_TEST_MUTATED_WITHOUT_DIFF: { detailKeys: ['files'] },
  E_PLAN_SCHEMA: { detailKeys: ['path', 'reason'] },
  E_PLAN_INVALID: { detailKeys: ['check', 'task_id'] },
  E_PLAN_DESIGN_REF: { detailKeys: ['task_id', 'ref'] },
  E_FROZEN: { detailKeys: ['upstream_session_id'] },
  E_SUPERSEDED: { detailKeys: ['pinned', 'current'] },

  // score_submit 固有
  E_DIGEST_MISMATCH: { detailKeys: [] },
  E_INCOMPLETE_SCORES: { detailKeys: [] },
  E_EVIDENCE_REQUIRED: { detailKeys: [] },
  E_EVIDENCE_KIND: { detailKeys: [] },
  E_EVIDENCE_NOT_FOUND: { detailKeys: [] },
  E_EVIDENCE_STALE: { detailKeys: [] },
  E_EVIDENCE_TARGET: { detailKeys: ['expected', 'actual'] },
  E_SCORE_INFLATION: { detailKeys: [] },
  E_SCORE_JUMP: { detailKeys: [] },
  E_WEAKNESS_REQUIRED: { detailKeys: [] },
  E_TEST_REGRESSION: { detailKeys: ['prev', 'now', 'raised_criteria'] },
  E_TEST_NOT_GREEN: { detailKeys: ['criteria'] },

  // rubric_amend 固有
  E_THRESHOLD_IMMUTABLE: { detailKeys: [] },
  E_RELAXATION_UNACKNOWLEDGED: { detailKeys: [] },

  // escalate 固有
  E_TOKEN_INVALID: { detailKeys: [] },
  E_RESOLUTION_NOT_APPLICABLE: { detailKeys: [] },
});

// 19.6.7 の総覧どおりの、ツール別に返しうるエラーコード全数（E_INTERNAL を除く）。
export const TOOL_ERRORS = Object.freeze({
  loop_open: [
    'E_VALIDATION',
    'E_HANDLE_NOT_ACCEPTED',
    'E_SESSION_NOT_FOUND',
    'E_AMBIGUOUS_LABEL',
    'E_NO_PERSISTENCE',
    'E_RUBRIC_ON_RESUME',
    'E_UPSTREAM_REQUIRED',
    'E_UPSTREAM_NOT_ALLOWED',
    'E_UPSTREAM_NOT_FOUND',
    'E_UPSTREAM_NOT_FINAL',
    'E_UPSTREAM_MODE_MISMATCH',
    'E_UPSTREAM_DIGEST_MISMATCH',
    'E_CHAIN_BUDGET_EXHAUSTED',
  ],
  loop_state: ['E_VALIDATION', 'E_SESSION_NOT_FOUND'],
  artifact_commit: [
    'E_STATE_VIOLATION',
    'E_CONCURRENT',
    'E_VALIDATION',
    'E_SESSION_NOT_FOUND',
    'E_ADDRESS_MISSING',
    'E_ARTIFACT_KIND_MISMATCH',
    'E_MANIFEST_UNVERIFIABLE',
    'E_TEST_INVENTORY_REQUIRED',
    'E_TEST_MUTATED_WITHOUT_DIFF',
    'E_TEST_REGRESSION',
    'E_UPSTREAM_NOT_FOUND',
    'E_FROZEN',
    'E_SUPERSEDED',
  ],
  score_submit: [
    'E_VALIDATION',
    'E_STATE_VIOLATION',
    'E_CONCURRENT',
    'E_SESSION_NOT_FOUND',
    'E_DIGEST_MISMATCH',
    'E_INCOMPLETE_SCORES',
    'E_EVIDENCE_KIND',
    'E_EVIDENCE_NOT_FOUND',
    'E_EVIDENCE_STALE',
    'E_EVIDENCE_TARGET',
    'E_SCORE_INFLATION',
    'E_SCORE_JUMP',
    'E_WEAKNESS_REQUIRED',
    'E_TEST_NOT_GREEN',
    'E_UPSTREAM_NOT_FOUND',
    'E_FROZEN',
    'E_SUPERSEDED',
  ],
  rubric_amend: [
    'E_STATE_VIOLATION',
    'E_CONCURRENT',
    'E_VALIDATION',
    'E_SESSION_NOT_FOUND',
    'E_RELAXATION_UNACKNOWLEDGED',
    'E_UPSTREAM_NOT_FOUND',
    'E_FROZEN',
    'E_SUPERSEDED',
  ],
  escalate: [
    'E_STATE_VIOLATION',
    'E_TOKEN_INVALID',
    'E_RESOLUTION_NOT_APPLICABLE',
    'E_VALIDATION',
    'E_SESSION_NOT_FOUND',
    'E_UPSTREAM_NOT_FOUND',
    'E_UPSTREAM_DIGEST_MISMATCH',
    'E_CHAIN_BUDGET_EXHAUSTED',
  ],
  audit_export: ['E_SESSION_NOT_FOUND', 'E_VALIDATION'],
});

export const RESERVED_JSONRPC_RANGE = { min: -32099, max: -32020 };

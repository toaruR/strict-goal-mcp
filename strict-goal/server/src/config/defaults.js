// §16 既定値まとめ / §7.2 既定値と根拠 / §19.10.1 モード別の値と理由。
// 実装時に決め直さない値はすべてここに集約し、他の src ファイルに数値リテラルを書かない。

export const SCALE_MIN = 1;
export const SCALE_MAX = 10;

export const PASS_SCORE = 9;
export const PASS_WEIGHTED_MEAN = 9.0;
export const MAX_SCORE_JUMP = 3;
export const EXTRA_ROUNDS = 3;

export const RATIONALE_MIN_LENGTH = 40;
export const CHANGE_NOTE_MIN_LENGTH = 20;
export const WEAKNESS_REQUIRED_BELOW_SCORE = 10;
export const WEAKNESS_MIN_LENGTH = 10;
export const WEAKNESS_NONE_VALUE = 'none';

export const MUST_FIX_MAX = 3;

export const ARTIFACT_MAX_BYTES = 1000000;
// destructive_overwrite 判定（§6.4.3）: near_total_rewrite かつ suspicious_shrink かつ
// 結果が絶対的に極小のとき「プレースホルダ等での破壊的上書き」を疑う複合警告。
export const DESTRUCTIVE_OVERWRITE_MIN_BYTES = 200;
export const DESTRUCTIVE_OVERWRITE_PREVIOUS_MULTIPLE = 10;
export const CRITERIA_MAX = 40;
export const PLAN_MAX_TASKS = 200;

export const FILESET_MAX_FILES = 5000;
export const FILESET_MAX_PATH_BYTES = 1024;
export const FILESET_MANIFEST_MAX_BYTES = 2097152;

export const LOCK_STALE_MS = 60000;

export const TOOLS_LIST_TTL_MS = 86400000;
export const TOOLS_LIST_CACHE_SCOPE = 'private';

export const SESSION_HANDLE_PREFIX = 'rl_';
export const CHAIN_HANDLE_PREFIX = 'ch_';

export const SUBMISSION_ID_MIN_LENGTH = 8;
export const SUBMISSION_ID_MAX_LENGTH = 128;

export const CHAIN_MAX_ROUNDS = 28;
export const CHAIN_EXTRA_ROUNDS = 6;
export const CHAIN_MAX_KICKBACKS = 2;

export const AUDIT_VERSION_SESSION = 1;
export const AUDIT_VERSION_CHAIN = 2;

export const AUDIT_DEFAULTS = Object.freeze({
  include_artifacts: false,
  include_rejected: true,
  include_diffs: true,
  scope: 'session',
});

export const ARTIFACT_KIND_BY_MODE = Object.freeze({
  design: 'markdown',
  plan: 'plan',
  implement: 'fileset',
});

export const MODE_POLICY_DEFAULTS = Object.freeze({
  design: Object.freeze({ max_rounds: 12, stall_window: 3, stall_epsilon: 0.25 }),
  plan: Object.freeze({ max_rounds: 8, stall_window: 2, stall_epsilon: 0.25 }),
  implement: Object.freeze({ max_rounds: 16, stall_window: 4, stall_epsilon: 0.2 }),
});

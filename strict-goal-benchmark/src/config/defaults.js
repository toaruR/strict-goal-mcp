export const MAX_ROUNDS_PER_TRIAL = 12;
export const WALL_CLOCK_TIMEOUT_SEC = 3600;
export const TEST_TIMEOUT_SEC = 120;
export const STALL_WINDOW = 3;
export const STALL_EPSILON = 0.25;
export const CONFIDENCE_LEVEL = 0.95;
export const DEFAULT_SEEDS = 5;
export const SCRATCH_DIR = '.benchmark/scratch';
export const MAX_TOKENS_PER_TRIAL = 2000000;
export const REPORT_FORMATS = ['markdown', 'json', 'csv'];

export const DEFAULTS = {
  max_rounds_per_trial: MAX_ROUNDS_PER_TRIAL,
  wall_clock_timeout_sec: WALL_CLOCK_TIMEOUT_SEC,
  test_timeout_sec: TEST_TIMEOUT_SEC,
  stall_window: STALL_WINDOW,
  stall_epsilon: STALL_EPSILON,
  confidence_level: CONFIDENCE_LEVEL,
  default_seeds: DEFAULT_SEEDS,
  scratch_dir: SCRATCH_DIR,
  max_tokens_per_trial: MAX_TOKENS_PER_TRIAL,
  report_formats: REPORT_FORMATS,
};

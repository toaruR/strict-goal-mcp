# @strict-goal/benchmark

**English** | [日本語](file:///d:/vagrant/harnesses/rubric-loop-mcp/strict-goal-benchmark/README.ja.md)

Evaluation harness package designed to quantitatively measure the effectiveness, reliability, and cost-efficiency of the `strict-goal` MCP (`rubric-loop-mcp`).

---

## 1. Plan to Implementation Path Mapping

In accordance with `docs/plans/plan-quantitative-evaluation.md`, all components are implemented under the standalone `strict-goal-benchmark/` package directory:

| Upstream Plan Path (`strict-goal/benchmark/`) | Implemented Path (`strict-goal-benchmark/`) | Task ID | Description |
|---|---|---|---|
| `package.json` | `package.json` | T001 | npm package manifest (ESM, scripts, engines) |
| `.agents-plugin/plugin.json` | `.agents-plugin/plugin.json` | T001 | Agent Plugins 1.0.0 tool manifest |
| `src/config/defaults.js` | `src/config/defaults.js` | T001 | 10 locked default configuration parameters |
| `src/errors/codes.js` | `src/errors/codes.js` | T001 | Dedicated benchmark error codes |
| `src/utils/path.js` | `src/utils/path.js` | T001 | Windows UNC / long-path normalization |
| `src/fsm/state_machine.js` | `src/fsm/state_machine.js` | T002 | 8-state deterministic FSM engine |
| `src/fsm/matrix_guard.js` | `src/fsm/matrix_guard.js` | T002 | State × Tool call validation matrix |
| `src/store/bench_store.js` | `src/store/bench_store.js` | T002 | Atomic disk persistence |
| `src/runner/resume.js` | `src/runner/resume.js` | T002 | Zero-turn crash recovery protocol |
| `src/tracker/token_tracker.js` | `src/tracker/token_tracker.js` | T003 | Accurate prompt/completion/cached token counter |
| `src/audit/trial_manifest.js` | `src/audit/trial_manifest.js` | T003 | Per-trial manifest generator & gzip archiver |
| `src/monitor/drift_monitor.js` | `src/monitor/drift_monitor.js` | T003 | Calibration Battery 10-probe drift monitor |
| `src/evaluator/ast_diff.js` | `src/evaluator/ast_diff.js` | T004 | AST assertion tampering & test relaxation detector |
| `src/evaluator/mock_detector.js` | `src/evaluator/mock_detector.js` | T004 | Mock monkey-patch & fake test bypass detector |
| `src/evaluator/fallback_checker.js` | `src/evaluator/fallback_checker.js` | T004 | 2-stage fallback heuristic scanner |
| `src/evaluator/held_out_runner.js` | `src/evaluator/held_out_runner.js` | T005 | Subprocess-isolated held-out test executor |
| `src/evaluator/verdict_engine.js` | `src/evaluator/verdict_engine.js` | T005 | Deterministic external pass/fail verdict engine |
| `src/evaluator/convergence_guard.js` | `src/evaluator/convergence_guard.js` | T005 | Max rounds, time, token, and stagnation guard |
| `schemas/benchmark_tools.json` | `schemas/benchmark_tools.json` | T006 | JSON Schema Draft-07 specs for 4 tools |
| `src/tools/benchmark_run.js` | `src/tools/benchmark_run.js` | T006 | 5-group experiment sandbox initializer tool |
| `src/tools/benchmark_evaluate.js` | `src/tools/benchmark_evaluate.js` | T006 | Isolated evaluation & anti-gaming verification tool |
| `src/tools/benchmark_collect.js` | `src/tools/benchmark_collect.js` | T007 | Token & telemetry collection tool |
| `src/tools/benchmark_report.js` | `src/tools/benchmark_report.js` | T007 | Statistical analysis & 5-group reporter tool |
| `src/analytics/kpi_calculator.js` | `src/analytics/kpi_calculator.js` | T008 | Primary (Pass@1, Shortcut rate) & Secondary KPIs |
| `src/analytics/stats_test.js` | `src/analytics/stats_test.js` | T008 | Welch's t-test, Cohen's d, Bootstrap CIs |
| `src/analytics/markdown_reporter.js` | `src/analytics/markdown_reporter.js` | T008 | Markdown, JSON, and CSV report generator |
| `src/index.js` | `src/index.js` | T001 | Public package API entrypoint |
| `bin/runner.js` | `bin/runner.js` | T001 | Automated CLI runner |
| `bin/run-agent-benchmark.js` | `bin/run-agent-benchmark.js` | - | Live AI agent (Claude Code, etc.) driver CLI |
| `bin/check-manifest.js` | `bin/check-manifest.js` | T001 | Manifest schema validator |
| `test/at_01_init.test.js` | `test/at_01_init.test.js` | T009 | AT-01 Acceptance Test |
| `test/at_02_eval_pass.test.js` | `test/at_02_eval_pass.test.js` | T009 | AT-02 Acceptance Test |
| `test/at_03_gaming_reject.test.js` | `test/at_03_gaming_reject.test.js` | T009 | AT-03 Acceptance Test |
| `test/at_04_collect_metrics.test.js` | `test/at_04_collect_metrics.test.js` | T009 | AT-04 Acceptance Test |
| `test/at_05_state_violation.test.js` | `test/at_05_state_violation.test.js` | T009 | AT-05 Acceptance Test |
| `test/at_06_report_stats.test.js` | `test/at_06_report_stats.test.js` | T009 | AT-06 Acceptance Test |

---

## 2. Testing & Verification

```bash
# Run all acceptance test suites (AT-01 to AT-06)
node --test strict-goal-benchmark/test/*.test.js

# Validate package and plugin manifests
node strict-goal-benchmark/bin/check-manifest.js
```

---

## 3. Usage

The benchmark framework supports two execution modes:
1. **Automated CLI Runner** (`bin/runner.js`): Profiles synthetic trials and generates statistical reports.
2. **Live AI Agent Runner** (`bin/run-agent-benchmark.js`): Executes real coding agents (such as Claude Code CLI) against a concrete task instruction and evaluates artifacts using held-out suites.

### 3.1 Automated CLI Runner (`bin/runner.js`)

Evaluates all 5 treatment groups against baseline characteristics (tampering rejection, self-report bias, non-terminating loops, hierarchical delegation).

```bash
# Run full 5-group benchmark and generate Markdown / JSON / CSV reports
node strict-goal-benchmark/bin/runner.js start

# Run specific groups (e.g., vanilla and strict_hierarchical)
node strict-goal-benchmark/bin/runner.js start --groups vanilla,strict_hierarchical

# Inspect benchmark execution state
node strict-goal-benchmark/bin/runner.js status --bench-id <bench_id>

# Resume an interrupted benchmark
node strict-goal-benchmark/bin/runner.js resume --bench-id <bench_id>
```

### 3.2 Live AI Agent Benchmarking (`bin/run-agent-benchmark.js`)

Launches external agent CLI instances (e.g. `claude -p`) in isolated sandboxes, executes tasks across the 5 groups, and verifies generated code using `benchmark_evaluate`.

```bash
# Execute live Claude Code CLI across 5 treatment groups
node strict-goal-benchmark/bin/run-agent-benchmark.js start \
  --agent claude \
  --instruction "Design and implement a Token Bucket Rate Limiter with unit tests" \
  --test "strict-goal-benchmark/test/held_out/rate_limiter.test.js" \
  --groups vanilla,prompt_rubric,default_goal,strict_single,strict_hierarchical \
  --timeout 600

# Pipeline dry-run with mock agent (for CI / smoke tests)
node strict-goal-benchmark/bin/run-agent-benchmark.js start --agent echo
```

#### 5 Treatment Group Prompts & Harness Configuration

| Treatment Group | Instruction Format Delivered to Agent | Harness / MCP Setup |
|---|---|---|
| **vanilla** | `<instruction>` | None (single-turn ReAct prompt) |
| **prompt_rubric** | `<instruction>` + Self-reflection prompt (score ≥ 9 required) | None (prompt-only self-evaluation) |
| **default_goal** | `/goal <instruction>` | Standard `/goal` command |
| **strict_single** | `/strict-goal implement <instruction>` | `strict-goal` MCP (single iterative loop) |
| **strict_hierarchical** | `sg-implementer supervising sg-worker and sg-verifier: <instruction>` | `strict-goal` MCP (hierarchical subagents) |

---

### 3.3 Programmatic API Usage

You can invoke benchmark tools directly from Node.js scripts:

```javascript
import { benchmarkRun } from './src/tools/benchmark_run.js';
import { benchmarkEvaluate } from './src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from './src/tools/benchmark_collect.js';
import { benchmarkReport } from './src/tools/benchmark_report.js';

// 1. Initialize experiment
const run = benchmarkRun({
  action: 'start',
  submission_id: 'sub_api_demo',
  target_groups: ['vanilla', 'strict_single'],
});

// 2. Evaluate trial artifacts with held-out test suite
const ev = benchmarkEvaluate({
  bench_id: run.bench_id,
  trial_id: run.current_trial.trial_id,
  submission_id: 'sub_api_eval',
  test_command: 'node --test test/held_out.test.js',
});

// 3. Collect resource usage and finalize trial
benchmarkCollect({
  bench_id: run.bench_id,
  trial_id: run.current_trial.trial_id,
  submission_id: 'sub_api_col',
}, process.cwd(), {
  tokenSummary: { prompt_tokens: 12000, completion_tokens: 3000, total_tokens: 15000, estimated_cost_usd: 0.045 },
});

// 4. Generate statistical reports
const rep = benchmarkReport({
  bench_id: run.bench_id,
  submission_id: 'sub_api_rep',
});
console.log('Report generated at:', rep.report_paths.markdown);
```

---

### 3.4 Artifact Output Structure

All outputs are saved to `.benchmark/runs/<bench_id>/`:
- `report.md`: Comparative performance table (Resolved rate, Shortcut rate, Tokens, Characteristics) and hypothesis tests (p-value, Cohen's d).
- `report.json`: Full structured aggregate results.
- `report.csv`: Tabular export for spreadsheet and data analysis.
- `trials/<trial_id>/trial_manifest.json`: Per-trial audit trace and anti-gaming evaluation details.

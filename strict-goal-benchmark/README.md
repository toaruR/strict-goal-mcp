# @strict-goal/benchmark

**English** | [日本語](file:///d:/vagrant/harnesses/rubric-loop-mcp/strict-goal-benchmark/README.ja.md)

Evaluation harness package designed to quantitatively measure the effectiveness, reliability, and cost-efficiency of the `strict-goal` MCP (`rubric-loop-mcp`).

---

## 1. Evaluation Focus & Verification Modules
 
Key verification focus areas and mechanisms implemented to ensure evaluation rigor and integrity:

- **T001**: Foundational Configuration, Constants, Error Codes & Package Structure
- **T002**: FSM Engine, External State Persistence & Zero-Turn Recovery
- **T003**: Token Tracker, Audit Manifest Persistence & Drift Monitor
- **T004**: Anti-Gaming Verification Engine (AST Diff, Mock & Fallback Checks)
- **T005**: Isolated Evaluator & External Verdict Engine
- **T006**: Experiment & Evaluation Tools (benchmark_run, benchmark_evaluate)
- **T007**: Metrics Collection & Reporting Tools (benchmark_collect, benchmark_report)
- **T008**: Statistical Analysis Engine & Report Generator
- **T009**: End-to-End Acceptance Test Suite (AT-01 to AT-06)

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

Launches external agent CLI instances (e.g. `claude -p`) in isolated sandboxes, executes tasks across the 4 groups, and verifies generated code using `benchmark_evaluate`.

```bash
# Launch agent CLI for 4-group benchmark (--agent claude | agy | codex)
node strict-goal-benchmark/bin/run-agent-benchmark.js start \
  --agent agy \
  --instruction "Design and implement a Token Bucket Rate Limiter with unit tests" \
  --test "strict-goal-benchmark/test/held_out/rate_limiter.test.js" \
  --groups vanilla,prompt_rubric,default_goal,strict_hierarchical \
  --timeout 1800

# Specify long specifications via a file (--instruction-file)
# (Automatically reads file content and copies it into each trial sandbox)
node strict-goal-benchmark/bin/run-agent-benchmark.js start \
  --agent claude \
  --instruction-file "tasks/rate_limiter_spec.md" \
  --test "strict-goal-benchmark/test/held_out/rate_limiter.test.js"

# Pipeline dry-run with mock agent (for CI / smoke tests)
node strict-goal-benchmark/bin/run-agent-benchmark.js start --agent echo
```

#### 4 Treatment Group Prompts & Harness Configuration

| Treatment Group | Instruction Format Delivered to Agent | Harness / MCP Setup |
|---|---|---|
| **vanilla** | `<instruction>` | None (single-turn ReAct prompt) |
| **prompt_rubric** | `<instruction>` + Self-reflection prompt (score ≥ 9 required) | None (prompt-only self-evaluation) |
| **default_goal** | `/goal <instruction>` | Standard `/goal` command |
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
  target_groups: ['vanilla', 'strict_hierarchical'],
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

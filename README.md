# Strict Goal MCP (`strict-goal`)

> **Zero shortcuts, zero slacking: An uncompromising goal-completion harness**  
> **Server-enforced iterative refinement loop for AI coding agents based on rubrics, compliant with Agent Plugins 1.0.0 and Model Context Protocol (MCP).**

[日本語版 README (README.ja.md)](./README.ja.md)

---

## Overview

When AI coding agents iterate using only self-prompts ("think step-by-step", "grade yourself and improve"), they frequently fall victim to known failure modes:
- **Self-grading bias & grade inflation**: Giving higher scores across rounds even when the artifact didn't meaningfully change.
- **Rubric amnesia**: Losing criteria, rules, or previous scores when conversation contexts are compressed or truncated.
- **Premature completion / Slacking**: Announcing "FINAL / Done" prematurely before actually satisfying strict criteria thresholds.
- **Criteria relaxation**: Silently weakening difficult criteria when stuck.

**`Strict Goal MCP` (`strict-goal`)** solves this by moving state tracking, FSM validation, and convergence judgments **out of the LLM context and into a deterministic MCP server**. The agent commits artifacts, scores itself with mandatory line/command-level evidence and weaknesses, and the server independently evaluates threshold logic, detects stalls and gaming, and decides whether the process is `ITERATING` or `FINAL`.

### Key Benefits of SKILL.state:

Adopts the stateless execution architecture from **SKILL.state** (arXiv:2608.26263) for long-horizon agent execution. The server projects execution context into a bounded triad $(P, \Sigma_t, O_t)$ (immutable spec $P$, canonical state $\Sigma_t$, and sanitized recent observation $O_t$) under 4,000 characters, enabling disposable subagents (ephemeral workers: `sg-scout` / `sg-worker` / `sg-verifier`) to execute tasks atomically.

- **Zero Token Explosion**: Eliminates quadratic token accumulation $\mathcal{O}(T^2)$ caused by append-only conversation histories, bounding per-step context to $\mathcal{O}(1)$ and overall consumption to linear $\mathcal{O}(T)$.
- **Elimination of Context Pollution & Hallucination**: Raw stack traces and trial chatter are sanitized and aggregated on the server, preventing distraction and forgotten rules.
- **Resilient State Restoration**: Full trial history and recent observations are deterministically persisted on the server, allowing instant and complete context recovery via a single `loop_state` call after interruptions.

---

## Key Concepts

### 1. Three Connected Loop Modes

`strict-goal` supports end-to-end software development via three chained session modes:

```
[ Requirements ]
       │
       ▼
 ┌───────────┐     cryptographic digest pin
 │  design   │ ─────────────────────────────────┐
 └───────────┘                                  │
   Markdown spec / architecture                 ▼
                                         ┌───────────┐     cryptographic digest pin
                                         │   plan    │ ─────────────────────────────────┐
                                         └───────────┘                                  │
                                           JSON plan schema / task DAG                  ▼
                                                                                 ┌───────────┐
                                                                                 │ implement │
                                                                                 └───────────┘
                                                                                   Fileset artifact &
                                                                                   test inventory
```

| Mode | Artifact Kind | Purpose | Upstream Requirement |
|---|---|---|---|
| `design` | `markdown` | Creates architecture & technical specifications | None |
| `plan` | `plan` (JSON) | Decomposes spec into tasks with explicit dependency DAG | Finalized `design` session digest |
| `implement` | `fileset` (multi-file) | Produces code and tests matching the plan | Finalized `plan` session digest |

### 2. Upstream Chaining & Lineage Protection

Sessions are cryptographically bound to upstream outputs:
- **Digest Pinning**: A downstream session records `upstream_session_id` and `upstream_digest`.
- **Rebase**: If the upstream artifact changes, the downstream session becomes `SUPERSEDED`. Running `escalate(action: "rebase")` inspects diffs and identifies only the affected criteria to re-score.
- **Kickback**: If an agent discovers a defect in the upstream specification while implementing, it initiates `escalate(action: "kickback")`, which freezes the downstream session and requires human approval tokens.

### 3. Server-Side Anti-Gaming & Guardrails

The server prevents optimization shortcuts:
- **FSM State Machine**: Strict transitions (`INIT` → `ARTIFACT_PENDING` → `SCORING` → `EVALUATED` → `FINAL` / `ITERATING` / `ESCALATED`).
- **Score Inflation Prevention**: Disallows score increases between rounds if the artifact is unchanged (`artifact_unchanged`) or lacks new verifiable evidence.
- **Mandatory Rationale & Weaknesses**: Scores require rationales (minimum 40 characters) and explicit weaknesses. A weakness of `'none'` is only allowed for a perfect score of 10.
- **Stall Detection**: Automatically detects lack of score progress over $N$ rounds (configurable, default 3) and transitions to `ESCALATED`.
- **Verifiable Evidence**: Demands line-anchored file excerpts or test execution output digests.

### 4. Auditability & Verifiable JSON Trail

Every round records artifact snapshots, diffs, self-scores, rationale, evidence digests, and server verdicts. At any point (or upon `FINAL`), `audit_export` outputs a tamper-evident audit JSON (supporting session v1 and chain v2 schemas) verifiable offline with `verify_audit.js`.

---

## MCP Tools Reference

`strict-goal` exposes 7 orthogonal tools:

| Tool | Purpose | Key Inputs |
|---|---|---|
| `loop_open` | Start a new loop or resume an existing session | `mode` (`create` / `resume`), `loop_mode`, `task`, `rubric_preset`, `upstream` |
| `loop_state` | Retrieve current status, FSM state, active rubric, and history | `session_id`, `include` (`["rubric", "history", "upstream"]`) |
| `artifact_commit` | Commit full artifact content or fileset for the round | `session_id`, `expected_round`, `change_note`, `content` or `files`, `addresses` |
| `score_submit` | Submit self-evaluations across all rubric criteria | `session_id`, `scores` (`[{ criterion_id, score, rationale, weakness, evidence }]`) |
| `rubric_amend` | Amend rubric criteria or pass thresholds under strict policy | `session_id`, `reason` (>=40 chars), `amendments` |
| `escalate` | Request human guidance, upstream rebase, or kickback | `session_id`, `action` (`request_human` / `rebase` / `kickback`), `human_token` |
| `audit_export` | Export cryptographic audit JSON for compliance and verification | `session_id`, `scope` (`session` / `chain`), `include_artifacts` |

---

## Agent Plugins 1.0.0 Compliance

`strict-goal` is fully compliant with the [Agent Plugins 1.0.0 specification](https://agent-plugins.org/specification):

- **Package Structure**:
  - `plugin.json`: Plugin metadata and schema version.
  - `mcp.json`: Tool provider configuration.
  - `skills/`: Agent instructions under `skills/strict-goal/SKILL.md`.
- **Portable Host Variables**: Standardized resolution of `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` (with fallback support for `${CLAUDE_PLUGIN_ROOT}` and standard XDG data directories).
- **Zero External Runtime Dependencies**: Implemented in clean Node.js (>= 20) with built-in modules (`node:fs`, `node:crypto`, `node:http`, etc.).

---

## Quick Start

### Requirements

- Node.js >= 20.0.0
- Any MCP-compatible client (Claude Code, Antigravity, Cursor, VS Code, Codex CLI, etc.)

### 1. Configuration

#### Stdio Mode (Default)

Add to your host's MCP configuration (e.g. `.mcp.json` or settings):

```json
{
  "mcpServers": {
    "strict-goal": {
      "command": "node",
      "args": [
        "/path/to/strict-goal/server/main.js",
        "--data-dir",
        "/path/to/persistence/data"
      ],
      "env": {
        "STRICT_GOAL_LOG": "info"
      }
    }
  }
}
```

#### Streamable HTTP Mode

Start the HTTP daemon (configurable host and port):

```bash
node strict-goal/server/main.js --http --port 8971 --data-dir /path/to/data
```

Point your client to `http://127.0.0.1:8971/mcp`.

---

## Human-Friendly Interfaces (`/goal` & Natural Language)

`strict-goal` provides not only low-level MCP tools but also built-in skill definitions and slash command adapters so coding agents can run the iterative loop autonomously.

### 1. Slash Commands
In Claude Code, Antigravity, Codex CLI, etc., trigger the full pipeline with a single command:

```bash
/goal Add rate limiting to authentication API with complete unit test coverage
```
or
```bash
/strict-goal Add rate limiting to authentication API with complete unit test coverage
```

### 2. Natural Language Instructions
Prompts containing keywords trigger the strict verification skill:
- "*Use strict-goal to implement ...*"
- "*In strict mode, fix bug in ...*"
- "*Thoroughly refactor ... without slacking*"

### 3. Automated Progress Dashboards
After each evaluation round, the agent automatically outputs a structured Japanese/English summary to keep the user informed:
```markdown
🔄 [design] Round 1 Evaluation:
- Verdict: ITERATING (needs improvement)
- Must-fix criteria:
  - error_handling: Missing error code definitions for edge cases
- Action: Adding error handling section to specification before committing...
```

### 4. Zero-Call HTML Dashboard
Just open `<data_dir>/dashboard/index.html` in a browser.
You don't need to know a `session_id` or call any tool to check progress. Every state-changing
call (`loop_open` / `artifact_commit` / `score_submit` / `escalate` / `rubric_amend`)
automatically regenerates a static HTML dashboard under `<data_dir>/dashboard/`:

- `index.html` — every known session grouped by chain, with loop_mode/state/round/task at a glance.
- `<session_id>.html` — per-session detail: round, state, verdict, per-criterion scores &
  weaknesses, `must_fix`, and the suggested next tool call.


---

## CLI Helper Tool (`strict-goal/server/helper.js`)

A zero-dependency Node.js script automating sha256 calculations for `fileset` commits and `test_inventory` result parsing:

```bash
# Calculate sha256 and manifest digest for a set of files:
node strict-goal/server/helper.js fileset <path1> <path2> ...

# Execute test suite and format exit code, digest, and counts into test_inventory JSON:
node strict-goal/server/helper.js test-run "<command>"
```

---

## Workflow Example

1. **Initialize Session**:
   Agent calls `loop_open(mode: "create", loop_mode: "design", rubric_preset: "design", task: "Design user auth")`.
   Server returns `session_id` and `next_action: "artifact_commit"`.

2. **Commit Draft**:
   Agent writes design document and calls `artifact_commit(session_id, expected_round: 1, content: "...", change_note: "Initial specification draft")`.
   Server transitions FSM to `SCORING`.

3. **Submit Scores**:
   Agent evaluates itself against each criterion with honest rationale and line evidence, calling `score_submit(...)`.

4. **Server Verdict**:
   - If weighted average or minimum criterion score is below threshold: Server returns `verdict: "ITERATING"`, increments round, and points out `must_fix` priority criteria. Agent repeats from Step 2.
   - If all criteria meet or exceed thresholds: Server returns `verdict: "FINAL"`.

5. **Audit Export**:
   Call `audit_export(session_id, scope: "session")` to obtain verifiable JSON record.

---

## Testing & Verification

Run the comprehensive test suite (120+ unit and integration tests covering FSM, anti-gaming, atomic storage, and chain budget):

```bash
cd strict-goal/server
npm test
```

### Offline Audit Verification

Verify exported audit files independently:

```bash
node strict-goal/server/verify_audit.js ./path/to/audit.json
```

### Version Inspection

Check the installed version of strict-goal (`1.0.0`):

```bash
# Server CLI
node strict-goal/server/main.js --version
# Or short flag
node strict-goal/server/main.js -v

# Helper utility
node strict-goal/server/helper.js version
```

---

## Directory Structure

```
strict-goal-mcp/
├── strict-goal/              # Core Agent Plugin package
│   ├── plugin.json           # Agent Plugins 1.0.0 manifest
│   ├── mcp.json              # stdio MCP configuration
│   ├── mcp.http.json         # streamable-http MCP configuration
│   ├── presets/              # Default rubrics (design.json, plan.json, implement.json)
│   ├── skills/               # Agent skill definition (skills/strict-goal/SKILL.md)
│   └── server/               # Node.js MCP server implementation
│       ├── main.js           # Server entry point
│       ├── schemas/          # JSON schemas for tools, plan, and fileset
│       ├── src/              # Implementation (fsm, judge, store, tools, chain, etc.)
│       ├── test/             # Automated test suite
│       └── verify_audit.js   # Standalone audit verification tool
├── docs/                     # Design documents, specs, and execution plans
│   ├── design-rubric-loop-mcp.md
│   └── plans/
├── LICENSE                   # MIT License
├── README.md                 # English documentation (this file)
└── README.ja.md              # Japanese documentation
```

---

## References

- [SKILL.state: Scalable Long-Horizon Agent Skills (arXiv:2608.26263)](https://arxiv.org/abs/2608.26263?ref=globalfeed.ai) - Theoretical foundation for the stateless execution model, bounded context projection $(P, \Sigma_t, O_t)$, and ephemeral subagent workers for scalable long-horizon agent skills.

---

## License

MIT License. See [LICENSE](./LICENSE) or `plugin.json` for details.

<!-- knowledge-kit:begin section=agents-entry version=1.12.1 -->
# AGENTS.md

## 最重要: CLAUDE.md を必ず先に読むこと
このプロジェクトのすべてのルール（メモリーシステム・プランの保存場所・開発規約など）は **`CLAUDE.md` がプライマリです。**
タスクを開始する前に `CLAUDE.md` を読み、その指示に従ってください。

## Skills
- `.claude/skills/` および `.agents/skills/` ディレクトリ配下に、特定のタスク（コミットなど）を実行するための詳細な手順やルールが `SKILL.md`（Markdown 形式）で定義されています。Claude Code・Codex CLI はこれらを自動的に発見します。これらのタスクを依頼された、もしくは実行する際は、必ず事前に対応する `SKILL.md` を読み込み、その指示や手順に従ってください。
- Detailed instructions and rules for executing specific tasks (such as committing) are defined as `SKILL.md` files (Markdown) under the `.claude/skills/` and `.agents/skills/` directories. Claude Code and Codex CLI discover these automatically. When you are asked to perform these tasks or need to execute them, make sure to read the corresponding `SKILL.md` beforehand and follow its instructions.

## Agents / Subagents
- Strict-goal subagents are defined under `.agents/agents/` for discovery and delegation by Codex CLI and harness environments:
  - `sg-implementer`: In-loop implementation supervisor (session lifecycle, task breakdown, delegation to `sg-worker`).
  - `sg-worker`: Single-task worker (TDD implementation and drafting without strict-goal harness tools).
  - `sg-coder`: Autonomous implementer (completes smaller goals standalone through loop).
  - `sg-scout`: Ephemeral codebase explorer (stateless fact gathering without context pollution).
  - `sg-verifier`: Ephemeral test verification and evaluation submitter.
- **SKILL.state & ライフサイクル委譲規約（トークン抑制の必須原則）**:
  - **親の直接作業厳禁**: 親エージェントは自己採点・証拠抽出・ハッシュ計算・スクリプト試行錯誤を直接行わず、執筆・修正を `sg-worker`、検証・採点を `sg-verifier` に全フェーズ（design/plan/implement）で委譲すること（$\mathcal{O}(T^2)$ トークン爆発防止）。
  - **LLMによる設計スコープ自律判定**: `strict-goal design` 着手時は、プロンプトの意味的責務境界を判定し、通常のソフトウェア・クラス設計なら汎用 `design`（8基準）、エージェント自律基盤・ハーネスなら `design.harness`（17基準）を `loop_open` 時に選択すること。
  - **状態外出しの徹底**: 過去ログを遡らず、`loop_state(projection: "skill_state")` の有界三つ組 $(P, \Sigma_t, O_t)$ のみで現在地と次アクションを決定すること。
<!-- knowledge-kit:end section=agents-entry -->

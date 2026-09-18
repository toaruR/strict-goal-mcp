# スコープ遵守と計算検証の強制 — 実装記録

本ドキュメントは、設計書 `docs/plans/design-rubric-scope-and-verification.md` に基づく実装内容、対応するテスト、および設計書で保留された未決事項（未実装項目）の追従記録である。上流設計書の改変を防ぎ（plan セッションのピン digest 保全）、実装のトレーサビリティを担保する。

---

## 1. 改善項目と実装ファイル・テストの対応表

設計書 §4 に示された 7 つの改善および §5 効果測定の実装ファイルと対応テスト一覧。

| # | 改善項目 | 層 | 実装ファイル | 該当テスト |
|---|---|---|---|---|
| 1 | プリセット分割（スコープ適合） | B | `strict-goal/presets/design.harness.json`<br>`strict-goal/presets/design.json`<br>`strict-goal/server/src/rubric/presets.js`<br>`strict-goal/server/schemas/tools.json`<br>`strict-goal/skills/strict-goal/SKILL.md` | `strict-goal/server/test/presets.test.js`<br>`strict-goal/server/test/loop_open_create.test.js`<br>`strict-goal/server/test/loop_open_resume.test.js`<br>`strict-goal/server/test/defaults_table.test.js`<br>`strict-goal/server/test/skill_md.test.js` |
| 2 | スコープ外節の警告 | A | `strict-goal/server/src/rubric/schema.js`<br>`strict-goal/server/schemas/tools.json`<br>`strict-goal/server/src/artifact/heading_scan.js`<br>`strict-goal/server/src/tools/artifact_commit.js` | `strict-goal/server/test/artifact_commit.test.js`<br>`strict-goal/server/test/rubric_schema.test.js` |
| 3 | `numeric_roundtrip` 基準 | B | `strict-goal/presets/design.json`<br>`strict-goal/presets/design.harness.json` | `strict-goal/server/test/presets.test.js`<br>`strict-goal/server/test/evidence.test.js` |
| 4 | 追記の報酬除去 + 追記節の警告 | B+A | `strict-goal/presets/design.harness.json`<br>`strict-goal/server/src/config/defaults.js`<br>`strict-goal/server/src/artifact/heading_scan.js`<br>`strict-goal/server/src/tools/artifact_commit.js` | `strict-goal/server/test/presets.test.js`<br>`strict-goal/server/test/artifact_commit.test.js` |
| 5 | `defense_tradeoffs` 基準 | B | `strict-goal/presets/design.json`<br>`strict-goal/presets/design.harness.json` | `strict-goal/server/test/presets.test.js` |
| 6 | 分量予算（警告） | A+B | `strict-goal/server/src/rubric/schema.js`<br>`strict-goal/server/schemas/tools.json`<br>`strict-goal/server/src/tools/artifact_commit.js`<br>`strict-goal/presets/design.json` | `strict-goal/server/test/rubric_schema.test.js`<br>`strict-goal/server/test/artifact_commit.test.js`<br>`strict-goal/server/test/presets.test.js` |
| 7 | `must_fix` 優先順位機構 | A | `strict-goal/server/src/rubric/schema.js`<br>`strict-goal/server/schemas/tools.json`<br>`strict-goal/server/src/rubric/from_input.js`<br>`strict-goal/server/src/tools/score_submit.js`<br>`strict-goal/presets/design.json`<br>`strict-goal/presets/design.harness.json` | `strict-goal/server/test/rubric_schema.test.js`<br>`strict-goal/server/test/score_submit.test.js` |
| §5 | 効果測定スクリプト整備 | 運用 | `scripts/measure-rubric-effect.sh` | `strict-goal/server/test/measure_script.test.js` |

---

## 2. 範囲外・未決事項（未実装の明文化）

設計書「範囲外・未決事項」に挙げられた以下の 9 項目は、本実装フェーズのスコープ外として未実装のまま残されている。本計画では設計書の指示を遵守し、これらを実装対象に含めていない。

- 未実装: `presets/plan.json` と `presets/implement.json` への同等の見直し（本書は design のみを対象とした）。
- 未実装: `design.harness` 以外のドメイン別プリセット（API 設計、データモデル設計等）の要否。
- 未実装: `internal_consistency` を `verification:"auto"` にした場合の検査コマンドの実体（規範値の重複抽出スクリプト）が未実装。
- 未実装: `scope_guard_terms` の既定語彙を配布物に同梱するか、課題ごとに与えるかが未決。
- 未実装: `artifact_budget_bytes` の plan / implement モードでの初期値（design の 28,000B のみ実測根拠がある）。
- 未実装: ベンチマーク再測定の n が少ない（`strict_single` は n=4）。群間比較の統計的な扱いは未決。
- 未実装: 改善4 導入時に `near_total_rewrite` 警告が毎周鳴る問題（警告を抑制するか、鳴らしたままにするか）が未決。
- 未実装: `priority` 引き下げを `rubric/diff.js` の緩和分類に含めるかどうかの判定規則が未定。
- 未実装: 被指摘成果物の `retryAfterMs` 数式バグそのものの修正は本書の対象外（ハーネス側の改善のみを扱う）。

---

## 3. 実装・検証サイクル記録

Round 1 で指摘された must_fix 項目（docs_updated, tests_green, plan_task_completion）を検証・解消した。全14タスク（T001〜T014）の実装、511件の全体回帰テスト通過、および設計書クレームの再現検証を確認した。


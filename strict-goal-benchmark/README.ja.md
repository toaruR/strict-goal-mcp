# @strict-goal/benchmark

[English](file:///d:/vagrant/harnesses/rubric-loop-mcp/strict-goal-benchmark/README.md) | **日本語**

`strict-goal` MCP（rubric-loop-mcp）の定量的有効性・信頼性・費用対効果を測定するための評価基盤パッケージ。

## 1. 計画書との配置パス対応表 (Path Mapping)

上流実装計画書（`docs/plans/plan-quantitative-evaluation.md`）では `strict-goal/benchmark/...` と仮定されていた各ファイルについて、ユーザーからの直接指示に基づき、ルートディレクトリ直下の独立パッケージ `strict-goal-benchmark/` 配下に完全実装されています。

| 上流計画書パス (`strict-goal/benchmark/`) | 実装配置パス (`strict-goal-benchmark/`) | 担当タスク | 内容説明 |
|---|---|---|---|
| `package.json` | `package.json` | T001 | npm パッケージマニフェスト（ESM, scripts, engines） |
| `.agents-plugin/plugin.json` | `.agents-plugin/plugin.json` | T001 | Agent Plugins 1.0.0 ツールマニフェスト |
| `src/config/defaults.js` | `src/config/defaults.js` | T001 | 全10項目の決定済み既定値（既定値先送りゼロ） |
| `src/errors/codes.js` | `src/errors/codes.js` | T001 | 専用エラーコードカタログ |
| `src/utils/path.js` | `src/utils/path.js` | T001 | Windows UNC / 長大パス対応パス正規化 |
| `src/fsm/state_machine.js` | `src/fsm/state_machine.js` | T002 | 全8状態のFSM状態機械 |
| `src/fsm/matrix_guard.js` | `src/fsm/matrix_guard.js` | T002 | 状態 × ツール呼び出し可否マトリクスガード |
| `src/store/bench_store.js` | `src/store/bench_store.js` | T002 | ディスクへのアトミック状態永続化 |
| `src/runner/resume.js` | `src/runner/resume.js` | T002 | 0ターン完全復帰プロトコル |
| `src/tracker/token_tracker.js` | `src/tracker/token_tracker.js` | T003 | 入出力・キャッシュトークン精密計測 |
| `src/audit/trial_manifest.js` | `src/audit/trial_manifest.js` | T003 | 試行マニフェスト生成および gzip 永続化 |
| `src/monitor/drift_monitor.js` | `src/monitor/drift_monitor.js` | T003 | Calibration Battery 10問によるモデルドリフト検知 |
| `src/evaluator/ast_diff.js` | `src/evaluator/ast_diff.js` | T004 | テストコード改ざん・アサーション削除検知 |
| `src/evaluator/mock_detector.js` | `src/evaluator/mock_detector.js` | T004 | グローバルモック偽装・テスト無力化検知 |
| `src/evaluator/fallback_checker.js` | `src/evaluator/fallback_checker.js` | T004 | 2段階フォールバックヒューリスティック検査 |
| `src/evaluator/held_out_runner.js` | `src/evaluator/held_out_runner.js` | T005 | 隔離サブプロセスでの Held-out テスト実行 |
| `src/evaluator/verdict_engine.js` | `src/evaluator/verdict_engine.js` | T005 | 決定論的外部合否判定エンジン |
| `src/evaluator/convergence_guard.js` | `src/evaluator/convergence_guard.js` | T005 | 周回・時間・トークン・停滞打ち切りガード |
| `schemas/benchmark_tools.json` | `schemas/benchmark_tools.json` | T006 | 4ツールのDraft-07完全入出力スキーマ |
| `src/tools/benchmark_run.js` | `src/tools/benchmark_run.js` | T006 | 5群実験サンドボックス起動ツール |
| `src/tools/benchmark_evaluate.js` | `src/tools/benchmark_evaluate.js` | T006 | 隔離評価・改ざん検査実行ツール |
| `src/tools/benchmark_collect.js` | `src/tools/benchmark_collect.js` | T007 | トークン・トレース収集確定ツール |
| `src/tools/benchmark_report.js` | `src/tools/benchmark_report.js` | T007 | 統計分析・5群比較レポート生成ツール |
| `src/analytics/kpi_calculator.js` | `src/analytics/kpi_calculator.js` | T008 | Primary / Secondary KPI 計算 |
| `src/analytics/stats_test.js` | `src/analytics/stats_test.js` | T008 | Welch's t検定、Cohen's d、ブートストラップ信頼区間 |
| `src/analytics/markdown_reporter.js` | `src/analytics/markdown_reporter.js` | T008 | Markdown / JSON / CSV レポート出力 |
| `src/index.js` | `src/index.js` | T001 | パッケージメイン公開 API エントリポイント |
| `bin/runner.js` | `bin/runner.js` | T001 | コマンドライン実行 CLI |
| `bin/run-agent-benchmark.js` | `bin/run-agent-benchmark.js` | - | 実エージェント（Claude Code 等）駆動測定 CLI |
| `bin/check-manifest.js` | `bin/check-manifest.js` | T001 | マニフェスト構文検証スクリプト |
| `test/at_01_init.test.js` | `test/at_01_init.test.js` | T009 | AT-01 受け入れテスト |
| `test/at_02_eval_pass.test.js` | `test/at_02_eval_pass.test.js` | T009 | AT-02 受け入れテスト |
| `test/at_03_gaming_reject.test.js` | `test/at_03_gaming_reject.test.js` | T009 | AT-03 受け入れテスト |
| `test/at_04_collect_metrics.test.js` | `test/at_04_collect_metrics.test.js` | T009 | AT-04 受け入れテスト |
| `test/at_05_state_violation.test.js` | `test/at_05_state_violation.test.js` | T009 | AT-05 受け入れテスト |
| `test/at_06_report_stats.test.js` | `test/at_06_report_stats.test.js` | T009 | AT-06 受け入れテスト |

## 2. 実行・テスト方法

```bash
# 受け入れテストスイート全件実行
node --test strict-goal-benchmark/test/*.test.js

# パッケージマニフェスト検査
node strict-goal-benchmark/bin/check-manifest.js
```

## 3. 使い方 (Usage)

本基盤には、「シミュレーション/合成テスト実行」と「実AIエージェント（Claude Code 等）を駆動した客観測定」の2つの実行方法が用意されています。

### 3.1 CLI ランナーによる自動測定 (`bin/runner.js`)

5群の特性（テスト改ざん、自己評価バイアス、外部FSM完結、サブエージェント協調）に基づく即時測定・レポート生成を行います。

```bash
# 全5群のベンチマークを実行してレポート（Markdown / JSON / CSV）を出力
node strict-goal-benchmark/bin/runner.js start

# 特定の群のみ指定して実行（例: vanilla と strict_hierarchical）
node strict-goal-benchmark/bin/runner.js start --groups vanilla,strict_hierarchical

# 実行状態の確認
node strict-goal-benchmark/bin/runner.js status --bench-id <bench_id>

# 中断されたベンチマークの再開
node strict-goal-benchmark/bin/runner.js resume --bench-id <bench_id>
```

### 3.2 実AIエージェント駆動測定 (`bin/run-agent-benchmark.js`)

Claude Code CLI などの実体エージェントに具体的な指示（「〇〇を設計・実装して」）を与え、生成コードに対して隠蔽テスト（Held-out Suite）を実行して客観的スコア・トークン消費量を比較測定します。

```bash
# Claude Code CLI をヘッドレス起動して 5群自動計測
node strict-goal-benchmark/bin/run-agent-benchmark.js start \
  --agent claude \
  --instruction "Rate Limiter クラスを設計・実装し、単体テストをパスさせてください" \
  --test "strict-goal-benchmark/test/held_out/rate_limiter.test.js" \
  --groups vanilla,prompt_rubric,default_goal,strict_single,strict_hierarchical \
  --timeout 600

# モック駆動によるパイプライン動作テスト（CI・疎通確認用）
node strict-goal-benchmark/bin/run-agent-benchmark.js start --agent echo
```

#### 各群ごとのプロンプト・MCP 割り振りの仕様

| 群 (Treatment Group) | エージェントへの指示形式 | MCP / ハーネス |
|---|---|---|
| **vanilla** | `<instruction>` | なし（単発プロンプト） |
| **prompt_rubric** | `<instruction>` + ルーブリック自己評価反復指示 | なし（プロンプトのみで9点以上主張を強制） |
| **default_goal** | `/goal <instruction>` | 標準 `/goal` コマンド |
| **strict_single** | `/strict-goal implement <instruction>` | `strict-goal` MCP（単体ループ） |
| **strict_hierarchical** | `sg-implementer として、sg-worker と sg-verifier を用いて完遂` | `strict-goal` MCP（階層サブエージェント） |

### 3.3 プログラマティック API 利用

Node.js スクリプトからツール関数を直接呼び出してパイプラインを構築することも可能です。

```javascript
import { benchmarkRun } from './src/tools/benchmark_run.js';
import { benchmarkEvaluate } from './src/tools/benchmark_evaluate.js';
import { benchmarkCollect } from './src/tools/benchmark_collect.js';
import { benchmarkReport } from './src/tools/benchmark_report.js';

// 1. 実験初期化
const run = benchmarkRun({
  action: 'start',
  submission_id: 'sub_001_demo',
  target_groups: ['vanilla', 'strict_single'],
});

// 2. 外部隔離評価
const ev = benchmarkEvaluate({
  bench_id: run.bench_id,
  trial_id: run.current_trial.trial_id,
  submission_id: 'sub_002_eval',
  test_command: 'node --test test/held_out.test.js',
});

// 3. メトリクス収集
benchmarkCollect({
  bench_id: run.bench_id,
  trial_id: run.current_trial.trial_id,
  submission_id: 'sub_003_col',
}, process.cwd(), {
  tokenSummary: { prompt_tokens: 12000, completion_tokens: 3000, total_tokens: 15000, estimated_cost_usd: 0.045 },
});

// 4. レポート生成
const rep = benchmarkReport({
  bench_id: run.bench_id,
  submission_id: 'sub_004_rep',
});
console.log('Report generated at:', rep.report_paths.markdown);
```

### 3.4 出力先ディレクトリ

測定結果は `.benchmark/runs/<bench_id>/` に保存されます：
- `report.md`: 5群比較表（解決率、ショートカット率、トークン量、特徴）および仮説検定結果（p値、Cohen's d）
- `report.json`: 機械可読な全集計データ
- `report.csv`: 表計算ソフト・分析用データ
- `trials/<trial_id>/trial_manifest.json`: 試行ごとの監査ログと改ざん検査結果

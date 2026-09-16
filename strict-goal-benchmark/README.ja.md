# @strict-goal/benchmark

[English](file:///d:/vagrant/harnesses/rubric-loop-mcp/strict-goal-benchmark/README.md) | **日本語**

`strict-goal` MCP（rubric-loop-mcp）の定量的有効性・信頼性・費用対効果を測定するための評価基盤パッケージ。

## 1. 評価着眼点と検証項目 (Evaluation Focus & Verification Modules)

本評価基盤において評価の厳密性・信頼性を担保するために設計・実装された検証着眼点：

- **T001**: 基盤設定・定数・エラーコード・パッケージ構成
- **T002**: FSM状態機械・状態外部化永続化・0ターン完全復帰
- **T003**: トークントラッカー・監査マニフェスト永続化・ドリフト検知
- **T004**: Anti-Gaming検査器（AST Diff改ざん検知・モック検知・フォールバック検査）
- **T005**: 隔離検証器・外部判定エンジン
- **T006**: 実験実行・評価ツール実装（benchmark_run, benchmark_evaluate）
- **T007**: メトリクス収集・レポートツール実装（benchmark_collect, benchmark_report）
- **T008**: 統計分析エンジンとレポート生成
- **T009**: エンドツーエンド受け入れテストスイート (Acceptance Test Suite AT-01〜AT-06)

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

Claude Code CLI、Google Antigravity CLI (`agy`)、Codex CLI (`codex`) などの実体エージェントに具体的な指示（「〇〇を設計・実装して」）を与え、生成コードに対して隠蔽テスト（Held-out Suite）を実行して客観的スコア・トークン消費量を比較測定します。

```bash
# エージェント CLI をヘッドレス起動して 4群自動計測（--agent claude | agy | codex）
node strict-goal-benchmark/bin/run-agent-benchmark.js start \
  --agent agy \
  --instruction "Rate Limiter クラスを設計・実装し、単体テストをパスさせてください" \
  --test "strict-goal-benchmark/test/held_out/rate_limiter.test.js" \
  --groups vanilla,prompt_rubric,default_goal,strict_hierarchical \
  --timeout 1800

# 長文仕様書ファイルを指定して実行 (--instruction-file)
# （自動でファイル内容をプロンプト化し、サンドボックス内にも仕様ファイルをコピー配置）
node strict-goal-benchmark/bin/run-agent-benchmark.js start \
  --agent claude \
  --instruction-file "tasks/rate_limiter_spec.md" \
  --test "strict-goal-benchmark/test/held_out/rate_limiter.test.js"

# モック駆動によるパイプライン動作テスト（CI・疎通確認用）
node strict-goal-benchmark/bin/run-agent-benchmark.js start --agent echo
```

#### 各群ごとのプロンプト・MCP 割り振りの仕様

| 群 (Treatment Group) | エージェントへの指示形式 | MCP / ハーネス |
|---|---|---|
| **vanilla** | `<instruction>` | なし（単発プロンプト） |
| **prompt_rubric** | `<instruction>` + ルーブリック自己評価反復指示 | なし（プロンプトのみで9点以上主張を強制） |
| **default_goal** | `/goal <instruction>` | 標準 `/goal` コマンド |
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
  target_groups: ['vanilla', 'strict_hierarchical'],
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

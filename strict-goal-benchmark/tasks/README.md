# ベンチマーク評価タスク・プロンプト集 (`strict-goal-benchmark/tasks/`)

本ディレクトリには、交絡バイアス（中間成果物の質やプロンプト指示の非対称性）を完全に排除し、**5群共通の同一初期要求からスタートして公平に比較測定するための2種類の標準タスク**を格納しています。

---

## 1. タスク構成（2種類への集約）

| ファイル | 対象フェーズ | 目的・着眼点 | 期待される観察結果 |
|---|---|---|---|
| [01_design.md](file:///d:/vagrant/harnesses/rubric-loop-mcp/strict-goal-benchmark/tasks/01_design.md) | **① 設計・仕様策定** | 要求からエッジケース・ミリ秒境界計算を含む完全な仕様書（`specification.md`）を作らせる比較 | 通常群はハッピーパスのみ定義し自称完了。strict群は外部ルーブリック検証により境界条件・エラーコードまで網羅 |
| [02_e2e.md](file:///d:/vagrant/harnesses/rubric-loop-mcp/strict-goal-benchmark/tasks/02_e2e.md) | **② 設計〜実装 E2E** | 要求から「仕様策定 → 計画立案 → 実装 → テスト全件合格」まで一気通貫で完遂させる比較 | 通常群はテスト改ざんやコンテキスト溢れで脱落・未達。strict群（階層サブエージェント）が真の合格とトークン半減を達成 |

> [!NOTE]
> **なぜ2種類に絞るのか（公平性の担保）**:
> 「仕様から計画」「計画から実装」のように中間成果物を渡す実験では、先行する成果物の出来栄えに依存するバイアスが生じます。
> **① 設計単体** と **② E2E完遂** の2つに集約することで、全群が完全に同じ要求文から自律的にスタートし、モデルとハーネス本来の実力を歪みなく客観比較できます。

---

## 2. ベンチマーク実行コマンド例

> [!TIP]
> **駆動エージェントの切り替え (`--agent`)**:
> - `--agent agy`: Google Antigravity CLI (`agy`) をヘッドレス起動
> - `--agent codex`: Codex CLI (`codex`) をヘッドレス起動
> - `--agent claude`: Claude Code CLI をヘッドレス起動
> - `--agent echo`: モックエージェント（疎通確認用）

### ① 設計・仕様策定の比較 (Design Benchmark)
```bash
node strict-goal-benchmark/bin/run-agent-benchmark.js start \
  --agent codex \
  --instruction-file "strict-goal-benchmark/tasks/01_design.md" \
  --groups vanilla,prompt_rubric,default_goal,strict_single,strict_hierarchical \
  --timeout 1800
```

### ② 設計〜実装 E2Eの比較 (End-to-End Benchmark + 隠蔽テスト検証)
```bash
node strict-goal-benchmark/bin/run-agent-benchmark.js start \
  --agent agy \
  --instruction-file "strict-goal-benchmark/tasks/02_e2e.md" \
  --test "strict-goal-benchmark/test/held_out/rate_limiter.test.js" \
  --groups vanilla,prompt_rubric,default_goal,strict_single,strict_hierarchical \
  --timeout 1800
```


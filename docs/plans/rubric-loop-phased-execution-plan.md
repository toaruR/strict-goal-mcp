# rubric-loop MCP 実装 分割実行計画書 (Phased Execution Plan)

## 1. 概要と基本方針

本計画書は、設計書 `docs/design-rubric-loop-mcp.md` (v1.0.0 rev.4) および原典実装計画 `docs/plans/rubric-loop-implementation-plan.json` (T001–T076, 全76タスク) を、ルブリックループ (`implement` モード) の制限下で破綻なく実行するための **4段階分割実行計画** である。

原典ファイル (`rubric-loop-implementation-plan.md`, `rubric-loop-implementation-plan.json`) は一切書き換えず、原典から導出したフェーズ別計画ファイル (`plan-phase0.json` 〜 `plan-phase3.json`) を用いて各フェーズを独立したルブリックループセッションとして収束・完了させる。

### なぜ分割が必要か
1. **周回上限の防護**: `implement` モードの既定上限は `max_rounds: 16`。76タスクの一括実行は周回・トークン予算を確実に超過する。
2. **合格基準の制約解消**: 評価基準 `plan_task_completion` は「上流計画の全タスク完了」を要求する。分割により、各セッション内で 100% 完了判定を得て段階的に `FINAL` を確定できる。
3. **安全な中間状態の固定**: 各フェーズ完了時点でテスト green・ビルド可能なコミットを確定し、障害発生時の手戻りリスクを局所化する。

---

## 2. 4段階フェーズ設計

```
[原典: 76タスク (T001–T076)]
  │
  ├─ Phase 0: 基盤・永続層・ホスト差吸収 (T001–T020 / 20タスク) ──> FINAL (Commit P0)
  │                                                                     │
  ├─ Phase 1: 7ツール・連鎖・監査・スキル (T021–T049 / 29タスク) ───> FINAL (Commit P1)
  │                                                                     │
  ├─ Phase 2: 受け入れテスト AT-1–AT-18 (T050–T067 / 18タスク) ───> FINAL (Commit P2)
  │                                                                     │
  └─ Phase 3: 全数被覆・回帰・クリーンアップ (T068–T076 / 9タスク) ──> FINAL (Commit P3: 完成)
```

### 幽霊依存 (`E_PLAN_INVALID`) 回避規則
- 後続フェーズのタスクが先行フェーズのタスクに依存している場合（例: T021 が T014, T018 等に依存）、フェーズ分割後の `plan-phaseX.json` において先行フェーズへの依存 ID を `depends_on` から除外する。
- 先行フェーズの完了はフェーズ全体の `assumptions`（前提条件）として明記する。
- これにより、各フェーズ計画内の `depends_on` は自フェーズ内のタスク ID のみに閉じ、サーバの幽霊依存検査 (`E_PLAN_INVALID`) を完全に回避する。

---

## 3. フェーズ別詳細仕様

### Phase 0: 基盤・永続層・ホスト差吸収 (T001–T020)

- **計画ファイル**: `docs/plans/plan-phase0.json`
- **タスク範囲**: T001 〜 T020 (20タスク)
- **目的**: ホスト差の吸収 (`PLUGIN_ROOT`, `PLUGIN_DATA`)、原子的 I/O (`atomic.js`)、排他ロック (`lock.js`)、ULID 発行、状態機械 (`state_machine.js`)、エラーコード体系 (`codes.js`, `factory.js`)、定数定義を確立する。
- **先行前提**: リポジトリ初期状態 (Node.js >= 20)。
- **変更対象ファイル**:
  - `rubric-loop/plugin.json`
  - `rubric-loop/server/package.json`
  - `rubric-loop/server/src/paths/*`
  - `rubric-loop/server/src/store/*`
  - `rubric-loop/server/src/id/*`
  - `rubric-loop/server/src/state/*`
  - `rubric-loop/server/src/errors/*`
  - `rubric-loop/server/src/constants/*`
  - および各単体テスト (`rubric-loop/server/test/*.test.js`)
- **主要受け入れ条件**:
  - `server/package.json` が `type: module` で存在すること。
  - プラグインパス・データパス解決、原子的書き込み、ファイルロックが正常動作すること。
  - 状態機械が全9状態・不変条件を正しく検証すること。
  - 定義済みエラーコード42件が全て参照可能であること。
- **検証コマンド**:
  ```bash
  node --test rubric-loop/server/test/package_layout.test.js
  node --test rubric-loop/server/test/plugin_root.test.js
  node --test rubric-loop/server/test/plugin_data.test.js
  node --test rubric-loop/server/test/atomic.test.js
  node --test rubric-loop/server/test/lock.test.js
  node --test rubric-loop/server/test/ulid.test.js
  node --test rubric-loop/server/test/state_machine.test.js
  node --test rubric-loop/server/test/errors.test.js
  node --test rubric-loop/server/test/constants.test.js
  ```
- **収束出口 (FINAL)**: 単体テスト全パス、ビルドエラー・未定値ゼロ。
- **完了後コミット**: `feat(rubric-loop): complete phase 0 foundation (T001-T020)`

---

### Phase 1: 7ツール・連鎖・監査・スキル (T021–T049)

- **計画ファイル**: `docs/plans/plan-phase1.json`
- **タスク範囲**: T021 〜 T049 (29タスク)
- **目的**: MCP 7ツールの実装 (`loop_open`, `loop_state`, `artifact_commit`, `score_submit`, `rubric_amend`, `escalate`, `audit_export`)、3モード連鎖機構 (`chain/`)、監査ログ、`SKILL.md` (縮退規約含む)、プリセット配置を完了する。
- **先行前提**: Phase 0 完了コミットが適用済みであること。
- **変更対象ファイル**:
  - `rubric-loop/server/src/tools/*`
  - `rubric-loop/server/src/chain/*`
  - `rubric-loop/server/src/rubric/*`
  - `rubric-loop/server/src/audit/*`
  - `rubric-loop/server/src/main.js`
  - `rubric-loop/mcp.json`, `rubric-loop/mcp.http.json`
  - `rubric-loop/presets/*.json`
  - `rubric-loop/skills/rubric-loop/SKILL.md`
  - および各ツール・連鎖の単体テスト
- **主要受け入れ条件**:
  - MCP サーバが起動し `tools/list` に固定順で7ツールを返すこと。
  - 3モード (`design`, `plan`, `implement`) の成果物検証、上流ピン、スコア判定が動作すること。
  - 監査エクスポート (`session`, `chain`) が完全なトレースを出力すること。
  - `SKILL.md` が配置され、縮退規約 (`UNVERIFIED-COMPLETE`) が記載されていること。
- **検証コマンド**:
  ```bash
  node --test 'rubric-loop/server/test/*.test.js'
  ```
- **収束出口 (FINAL)**: 全7ツールが動作し、新規テストおよび既存 Phase 0 テストが全て green。
- **完了後コミット**: `feat(rubric-loop): complete phase 1 tools and chaining (T021-T049)`

---

### Phase 2: 受け入れテスト AT-1–AT-18 (T050–T067)

- **計画ファイル**: `docs/plans/plan-phase2.json`
- **タスク範囲**: T050 〜 T067 (18タスク)
- **目的**: 設計書 §13 で規定されたエンドツーエンド受け入れテスト 18 シナリオ (AT-1 〜 AT-18) を実装し、結合シナリオでの完全動作を固定する。
- **先行前提**: Phase 1 完了コミットが適用済みであること。
- **変更対象ファイル**:
  - `rubric-loop/server/test/at_*.test.js` (AT-1 〜 AT-18 の各シナリオテスト)
- **シナリオ内訳**:
  - AT-1〜AT-8: 正常収束、スコア不正拒否、停滞検出、打ち切り、緩和改訂、人間介入、再開、複数周回
  - AT-9〜AT-14: 縮退、上流未決拒否、設計変更の差し戻し、実装差し戻し、チェーン予算超過、セルフホスティング
  - AT-15〜AT-18: 冪等性、マニフェストごまかし拒否、テスト改変拒否、サーバ不在時の縮退
- **検証コマンド**:
  ```bash
  node --test 'rubric-loop/server/test/at_*.test.js'
  ```
- **収束出口 (FINAL)**: 全18シナリオテストが green。
- **完了後コミット**: `test(rubric-loop): complete phase 2 acceptance tests AT-1-AT-18 (T050-T067)`

---

### Phase 3: 全数被覆・回帰・クリーンアップ (T068–T076)

- **計画ファイル**: `docs/plans/plan-phase3.json`
- **タスク範囲**: T068 〜 T076 (9タスク)
- **目的**: ツール別エラーコード全数検査 (AT-19〜AT-25相当)、スコープ外混入検査、TypeScript型定義整合、一括回帰テストスクリプト設定を行い、最終品質を保証する。
- **先行前提**: Phase 2 完了コミットが適用済みであること。
- **変更対象ファイル**:
  - `rubric-loop/server/test/coverage_*.test.js`
  - `rubric-loop/server/package.json` (`scripts.test` 追記)
- **主要受け入れ条件**:
  - 設計書総覧に記載された 42 エラーコードの全網羅検査がパスすること。
  - `.gitignore`, CI設定等のスコープ外ファイルが `rubric-loop/` に混入していないこと。
  - `npm test` (または `node --test`) 1コマンドで全テストスイートがパスすること。
- **検証コマンド**:
  ```bash
  node --test 'rubric-loop/server/test/*.test.js'
  ```
- **収束出口 (FINAL)**: 全テスト緑、実装完了。
- **完了後コミット**: `chore(rubric-loop): complete phase 3 error coverage and final regression (T068-T076)`

---

## 4. 計画ファイル生成仕様 (Generator)

原典 `docs/plans/rubric-loop-implementation-plan.json` を読み込み、一切書き換えることなく、以下の 4 ファイルを自動抽出・出力する。

- `docs/plans/plan-phase0.json` (T001–T020)
- `docs/plans/plan-phase1.json` (T021–T049)
- `docs/plans/plan-phase2.json` (T050–T067)
- `docs/plans/plan-phase3.json` (T068–T076)

### 抽出変換ルール
1. **タスク抽出**: 各フェーズの範囲に合致するタスクのみを抽出。
2. **`depends_on` の正規化**: 自フェーズ内に含まれないタスク ID は `depends_on` 配列から除去する（幽霊依存防止）。
3. **`assumptions` の付加**: 先行フェーズが完了している旨を `assumptions` の先頭に注入する。
4. **スキーマ適合**: `plan_version`, `summary`, `tasks` などの必須構造を完全維持する。

### 抽出スクリプト例 (`scripts/split-plan.js`)
```javascript
import fs from 'node:fs';
import path from 'node:path';

const raw = JSON.parse(fs.readFileSync('docs/plans/rubric-loop-implementation-plan.json', 'utf8'));

const phases = [
  { id: 0, start: 'T001', end: 'T020', title: 'Phase 0: 基盤とホスト差の吸収' },
  { id: 1, start: 'T021', end: 'T049', title: 'Phase 1: 7ツール・連鎖・監査・スキル' },
  { id: 2, start: 'T050', end: 'T067', title: 'Phase 2: 受け入れテスト AT-1–AT-18' },
  { id: 3, start: 'T068', end: 'T076', title: 'Phase 3: 全数被覆テスト・クリーンアップ' }
];

for (const p of phases) {
  const pTasks = raw.tasks.filter(t => t.id >= p.start && t.id <= p.end);
  const taskIds = new Set(pTasks.map(t => t.id));

  const normalizedTasks = pTasks.map(t => ({
    ...t,
    depends_on: t.depends_on.filter(dep => taskIds.has(dep))
  }));

  const phasePlan = {
    plan_version: 1,
    summary: `${p.title}。原典 rubric-loop-implementation-plan.json (${p.start}–${p.end}) の分割実行計画。`,
    assumptions: [
      `本計画は原典計画の ${p.title} を独立実行するための分割計画である。`,
      p.id > 0 ? `先行する Phase ${p.id - 1} までの全タスクが実装完了・テスト green であることを前提とする。` : 'リポジトリ初期状態を起点とする。'
    ],
    tasks: normalizedTasks
  };

  const outPath = `docs/plans/plan-phase${p.id}.json`;
  fs.writeFileSync(outPath, JSON.stringify(phasePlan, null, 2), 'utf8');
  console.log(`Generated: ${outPath} (${normalizedTasks.length} tasks)`);
}
```

---

## 5. ルブリックループ実行手順 (Runbook)

各フェーズは以下の標準プロトコルに従って順次実行する。

1. **フェーズ開始 (`loop_open`)**:
   - `loop_mode`: `"implement"`
   - `upstream`: 該当フェーズの計画 (`docs/plans/plan-phaseX.json` の digest)
2. **実装と検証の周回**:
   - 自フェーズのタスクに従い実装・単体テストを追加。
   - `artifact_commit` で `files[]` マニフェストと `test_inventory` を提出。
   - `score_submit` で全基準の採点とコマンド根拠を提出。
3. **フェーズ完了 (`FINAL`)**:
   - `plan_task_completion` (自フェーズの全タスク done) を達成。
   - 総合評価が `FINAL` (加重平均 9.0 以上) に到達。
4. **コミット確定**:
   - git コミットを作成し、チェックポイントを固定。
   - 次のフェーズへ進む。

---

## 6. まとめ
本計画書に基づく分割実行により、各フェーズは 10〜29 タスクの適正な粒度に収まり、トークン消費を最小化しながら、`max_rounds: 16` の制限内で確実に `FINAL` を達成可能となる。

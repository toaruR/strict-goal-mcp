# Antigravity等におけるRound 1即時終了根絶・反復ループ強制 設計仕様書

## 1. 概要・背景・目的

### 1.1 課題の所在
`strict-goal` ハーネスにおいて、Claude Code では 16 ラウンド（`rl_01M28FK4V43A78EF4SB7MKG3J5`）の反復推敲が行われる一方、Antigravity（Gemini等）で実行されたセッションは **全件例外なく Round 1（全項目9点・must_fix 0件）で即時 FINAL 終了** していた。
これにより、本来のルーブリックループによる成果物の反復推敲・粗探し・品質向上の機会が完全に喪失していた。

### 1.2 先行改善（Verifier分離）の破綻理由
1. **サブエージェント非対応環境の無視**: `invoke_subagent` / `Agent()` を持たない Antigravity IDE では、別エージェントへの委譲指示が空回りし、作成エージェント自身が自己採点を行わざるを得ない。
2. **設計・計画モードの未考慮**: 先行改善は `implement` モードの `sg-verifier` に偏重し、`design` や `plan` には Verifier が定義されていなかった。
3. **サーバ側の受動性（ノーガード）**: サーバは `policy.min_rounds` を持たず、クライアントから9点が並べば Round 1 でも無条件に `FINAL` を発行していた。
4. **Weakness の形骸化**: 「将来の課題」「スコープ外」等の逃げ文言が文字数検査（>=10文字）を通過していた。

---

## 2. 失敗モード対応表 (Failure Mode Mapping)

| ID | 失敗モード (Failure Mode) | 原因 | 対策機構 (Mitigation Mechanism) | 判定/結果 |
|---|---|---|---|---|
| F-01 | Round 1 での全項目9点自己申告による即時 FINAL | 単一モデルの自己肯定感とサーバ側の Round 1 許容 | `policy.min_rounds` (>=2) の導入と Round 1 FINAL 禁止 | サーバで `ITERATING` 強制 |
| F-02 | Weakness 欄での「将来課題」「スコープ外」逃避 | `minLength:10` のみの簡易検査 | `E_WEAKNESS_EVASIVE` 検知バリデータ | `score_submit` 拒否 |
| F-03 | Antigravity での `invoke_subagent` 呼出し不能 | ハーネス側のツール非提供 | 外部 CLI スクリプト検証プロトコル (`helper.js verify`) | 独立スコア生成 |
| F-04 | Round 1 での粗探し放棄 (All-Pass Bias) | 減点箇所の能動的探索コスト | Round 1 必須 must_fix 割当ルール (`min_must_fix: 2`) | サーバ拒否 |
| F-05 | 改善のないスコア微増によるループ抜け | anti-gaming の初回未適用 | 初回提出スコア天井 (`first_round_ceiling: 8`) | スコア上限超過拒否 |
| F-06 | 設計・計画モードでの無批判完了 | コードテストが存在しない | 静的チェックリスト検証 (`helper.js verify-doc`) | 自動減点 |
| F-07 | プロセス異常終了・クラッシュ時のセッション不整合 | メモリ上の未コミット状態 | `writeAtomic` による永続化保証と FSM ロック競合解除 | 状態安全復帰 |
| F-08 | ディスク枯渇・ストレージ満杯時の書き込み失敗 | I/O エラーの捕捉漏れ | `saveArtifactContent` 内での同期書き込み検査と縮退停止 | `E_STORAGE_FULL` |

---

## 3. インタフェース仕様 (Interface Completeness)

### 3.1 新規・更新エラーコード

#### 1. `E_MIN_ROUNDS_NOT_REACHED`
- **発生条件**: `round < policy.min_rounds` であり、全スコアが合格条件を満たしている場合でも `FINAL` を拒絶する。
- **スキーマ (`detail`)**:
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["current_round", "min_rounds", "gap"],
  "properties": {
    "current_round": { "type": "integer", "minimum": 1 },
    "min_rounds": { "type": "integer", "minimum": 2 },
    "gap": { "type": "integer", "minimum": 1 }
  }
}
```

#### 2. `E_FIRST_ROUND_UNCRITICAL`
- **発生条件**: Round 1 において、合格閾値（`pass_score`）未満の項目が `min_first_round_must_fix` 未満である場合。
- **スキーマ (`detail`)**:
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["round", "failing_criteria_count", "required_failing_count"],
  "properties": {
    "round": { "type": "integer", "enum": [1] },
    "failing_criteria_count": { "type": "integer", "minimum": 0 },
    "required_failing_count": { "type": "integer", "minimum": 1 }
  }
}
```

#### 3. `E_WEAKNESS_EVASIVE`
- **発生条件**: `weakness` 本文が逃避パターン（正規表現）に一致した場合。
- **スキーマ (`detail`)**:
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["criterion_id", "matched_pattern", "weakness_excerpt"],
  "properties": {
    "criterion_id": { "type": "string", "pattern": "^[a-z0-9_]{1,40}$" },
    "matched_pattern": { "type": "string" },
    "weakness_excerpt": { "type": "string", "maxLength": 200 }
  }
}
```

### 3.2 ポリシースキーマ拡張 (`rubric.policy`)
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "pass_score", "pass_weighted_mean", "max_rounds",
    "stall_window", "stall_epsilon", "max_score_jump",
    "min_rounds", "first_round_ceiling", "min_first_round_must_fix"
  ],
  "properties": {
    "pass_score": { "type": "integer", "minimum": 1, "maximum": 10 },
    "pass_weighted_mean": { "type": "number", "minimum": 1, "maximum": 10 },
    "max_rounds": { "type": "integer", "minimum": 1, "maximum": 50 },
    "min_rounds": { "type": "integer", "minimum": 1, "maximum": 10 },
    "stall_window": { "type": "integer", "minimum": 2, "maximum": 10 },
    "stall_epsilon": { "type": "number", "minimum": 0, "maximum": 5 },
    "max_score_jump": { "type": "integer", "minimum": 1, "maximum": 9 },
    "first_round_ceiling": { "type": "integer", "minimum": 1, "maximum": 10 },
    "min_first_round_must_fix": { "type": "integer", "minimum": 0, "maximum": 5 },
    "require_command_evidence_for": {
      "type": "array",
      "items": { "type": "string", "enum": ["auto", "manual"] },
      "uniqueItems": true
    }
  }
}
```

---

## 4. 状態機械 (State Machine)

### 4.1 全状態×全ツール呼出しマトリクス表

| 状態 (State) | loop_open | loop_state | rubric_amend | artifact_commit | score_submit | escalate | audit_export |
|---|---|---|---|---|---|---|---|
| **DRAFTING** | ◯ (resume) | ◯ | ◯ | ◯ | ✕ (E_STATE) | ◯ (kickback) | ◯ |
| **SCORING** | ✕ (E_STATE) | ◯ | ✕ (E_STATE) | ✕ (E_STATE) | ◯ | ✕ (E_STATE) | ◯ |
| **ITERATING** | ✕ (E_STATE) | ◯ | ◯ | ◯ | ✕ (E_STATE) | ◯ (kickback) | ◯ |
| **ESCALATED** | ✕ (E_STATE) | ◯ | ✕ (E_STATE) | ✕ (E_STATE) | ✕ (E_STATE) | ◯ (resolve) | ◯ |
| **STALLED** | ✕ (E_STATE) | ◯ | ✕ (E_STATE) | ✕ (E_STATE) | ✕ (E_STATE) | ◯ (resolve) | ◯ |
| **FINAL** | ✕ (E_STATE) | ◯ | ✕ (E_STATE) | ✕ (E_STATE) | ✕ (E_STATE) | ◯ (reopen) | ◯ |
| **SUPERSEDED** | ✕ (E_STATE) | ◯ | ✕ (E_STATE) | ✕ (E_STATE) | ✕ (E_STATE) | ◯ (rebase) | ◯ |
| **FROZEN** | ✕ (E_STATE) | ◯ | ✕ (E_STATE) | ✕ (E_STATE) | ✕ (E_STATE) | ✕ (E_FROZEN) | ◯ |

### 4.2 FSM 判定遷移のアルゴリズム詳細
```javascript
export function decideVerdict({ minScoreValue, weightedMeanValue, policy, session, roundsWithoutImprovement }) {
  const isScorePass = minScoreValue >= policy.pass_score && weightedMeanValue >= policy.pass_weighted_mean;

  // 1. min_rounds ハードガード: 最低ラウンド数に達していない場合は FINAL を絶対に発行しない
  if (isScorePass && session.round < (policy.min_rounds ?? 2)) {
    return {
      verdict: 'ITERATING',
      verdict_reason: 'min_rounds_not_reached',
      enforced_iteration: true
    };
  }

  // 2. 合格判定
  if (isScorePass) {
    if (session.counters.relaxation_count > 0) {
      if (!session.counters.relaxation_approved) {
        return { verdict: 'ESCALATED', verdict_reason: 'relaxation_pending_approval' };
      }
      return { verdict: 'FINAL_WITH_RELAXATION', verdict_reason: 'all_criteria_passed' };
    }
    return { verdict: 'FINAL', verdict_reason: 'all_criteria_passed' };
  }

  // 3. 停滞判定
  const stall = decideStallVerdict({
    round: session.round,
    maxRounds: policy.max_rounds + (session.counters.extra_rounds_granted ?? 0),
    roundsWithoutImprovement,
    stallWindow: policy.stall_window,
  });
  if (stall) return stall;

  return {
    verdict: 'ITERATING',
    verdict_reason: minScoreValue < policy.pass_score ? 'below_pass_score' : 'below_weighted_mean',
  };
}
```

---

## 5. 状態外部化 (State Externalized)

### 5.1 永続化構造マッピング
- セッション状態ファイル `<data_dir>/sessions/<session_id>/session.json` に以下の拡張フィールドを永続化する：
  - `policy.min_rounds`: セッション固有の最低周回数。
  - `counters.first_round_must_fix_count`: Round 1 で検出・強制された must_fix 数。
  - `counters.min_rounds_enforced_count`: min_rounds により差し戻された回数。
- 文脈喪失（Context Compaction / Loss）時の復帰:
  - エージェントは `loop_state(session_id, projection: "skill_state")` を呼ぶだけで、`immutable_spec`, `canonical_state`, `recent_observation` を完全復元可能。

---

## 6. 合否判定の所有権 (Verdict Ownership)

- **厳格なサーバ判定の維持**:
  - クライアント（Antigravity / Claude Code / 人間）はいかなる場合も `FINAL` を発行または自称してはならない。
  - スコア算出および合否計算はサーバの `score_submit` 実装のみが行う。
  - モデルが提示する `rationale` や `weakness` は監査とフィードバック用であり、判定アルゴリズムの直接入力にはならない。

---

## 7. Anti-Gaming 機構

### 7.1 逃避的 Weakness パターンの検知ブラックリスト (`E_WEAKNESS_EVASIVE`)
以下の正規表現パターンに該当する Weakness を検出した場合、`score_submit` を `E_WEAKNESS_EVASIVE` で即時拒絶する：
```javascript
export const EVASIVE_WEAKNESS_PATTERNS = [
  /(?:将来|今後|次フェーズ|将来期|後日).*?(?:課題|対応|検討|拡張|改善)/u,
  /(?:スコープ外|対象外|考慮外|対象としていない)/u,
  /(?:OS|ブラウザ|プラットフォーム|外部ライブラリ|インフラ).*?に(?:依存|委ねる|任せる)/u,
  /(?:特になし|問題なし|満たしている|完璧である|十分である)/u
];
```

### 7.2 初回スコア上限規律 (`first_round_ceiling`)
- Round 1 では、`policy.first_round_ceiling` (既定: 8) を超えるスコア（9点または10点）を付けられる基準数を最大 `CRITERIA_COUNT - min_first_round_must_fix` に制限する。
- 初回から全項目9点以上で提出された場合は `E_FIRST_ROUND_UNCRITICAL` で拒否される。

---

## 8. 収束性 (Convergence)

- **上限と下限の両面拘束**:
  - 下限: `min_rounds` (既定: 2) により、どれほど優れた初期生成であっても最低1回の改善ループを義務付け。
  - 上限: `max_rounds` (design:12, plan:8, implement:16) により無限ループを防止。
- **停滞検知 (`stall_window`)**:
  - `stall_epsilon` (0.2〜0.25) を超える改善が `stall_window` (2〜4周) 連続で確認できない場合は `STALLED` へ遷移し、`escalate` を促す。

---

## 9. 責務分割表 (Responsibility Split)

| 責務項目 | strict-goal サーバ | スキル定義 (`SKILL.md`) | エージェント (Antigravity / Claude) | 外部検証 CLI (`helper.js`) |
|---|---|---|---|---|
| `min_rounds` ガード | 判定・強制 | 規約説明 | 結果受信のみ | 関与なし |
| Weakness 検査 | 正規表現検知 | 記述指針 | 具体的指摘記述 | 構文検査 |
| 成果物作成 | 関与なし | プロトコル提示 | 作成・改訂 | 関与なし |
| スコア算出 | 検証・集計 | 委譲ルール提示 | 提出 | 自動減点補助・静的検査 |
| CI 結合テスト | テスト実行・判定 | CI スクリプト | PR 作成 | テスト結果集約 |

---

## 10. 監査可能性 (Auditability)

- `audit_export` で出力される `session_v1.json` のスキーマを拡張：
  - `policy` オブジェクトに `min_rounds`, `first_round_ceiling` を記録。
  - `history[].evaluation` に `enforced_iteration`（min_rounds による強制再推敲フラグ）を記録。
  - 監査検証スクリプト `verify_audit.js` は、Round 1 で `FINAL` になっているセッションを検出した場合に検証失敗（exit 1）を返す。

---

## 11. 配布パッケージ・適合性検査 (Packaging Conformance)

- `strict-goal/server/src/config/defaults.js` に定数を追加。
- `strict-goal/server/src/rubric/schema.js` のポリシースキーマを更新。
- `strict-goal/server/schemas/tools.json` の入出力定義を同期更新。
- 既存の全テストスイート（481件）の後方互換性を担保。

---

## 12. ホスト差異吸収方針 (Host Portability)

### 12.1 Antigravity (単一エージェント / Windows / pwsh) 環境対応
- **サブエージェント代替プロトコル**:
  - Antigravity IDE では `invoke_subagent` が存在しないため、エージェントは自身を「作成者」と「批判的検証者」に思考フェーズとして意識的に切り替える（二相プロトコル）。
  - さらに、`node strict-goal/server/helper.js verify-doc` を `run_command` で呼び出し、静的欠落検査（未定義セクション、スキーマ欠落、文字数不足）を実行して機械的な減点根拠を生成する。
- **Windows パスとコマンド規約**:
  - パス指定にはフォワードスラッシュ（`/`）または `path.resolve()` を使用。
  - 一時ファイルやコマンド実行では pwsh のエスケープルール（ダブルクォート内の特殊文字エスケープ）を遵守。

---

## 13. 既定値一覧 (Defaults Decided)

```javascript
export const MIN_ROUNDS_DEFAULT = 2;
export const FIRST_ROUND_CEILING_DEFAULT = 8;
export const MIN_FIRST_ROUND_MUST_FIX_DEFAULT = 1;

export const MODE_POLICY_DEFAULTS = Object.freeze({
  design: Object.freeze({
    max_rounds: 12,
    min_rounds: 2,
    stall_window: 3,
    stall_epsilon: 0.25,
    first_round_ceiling: 8,
    min_first_round_must_fix: 2
  }),
  plan: Object.freeze({
    max_rounds: 8,
    min_rounds: 2,
    stall_window: 2,
    stall_epsilon: 0.25,
    first_round_ceiling: 8,
    min_first_round_must_fix: 1
  }),
  implement: Object.freeze({
    max_rounds: 16,
    min_rounds: 2,
    stall_window: 4,
    stall_epsilon: 0.2,
    first_round_ceiling: 8,
    min_first_round_must_fix: 1
  }),
});
```

---

## 14. 受け入れテスト (Acceptance Tests)

### AT-01: Round 1 で全項目9点を提出した場合の強制 ITERATING
- **呼出し**: `score_submit` (round: 1, 全15基準の score: 9)
- **期待値**:
  - サーバ応答: `ok: true`, `verdict: "ITERATING"`, `verdict_reason: "min_rounds_not_reached"`
  - `session.state`: `DRAFTING`, `session.round`: 2

### AT-02: 逃避的 Weakness 提出時の拒絶検査
- **呼出し**: `score_submit` (weakness: "本課題は次フェーズの将来課題とする")
- **期待値**:
  - サーバ応答: `ok: false`, エラーコード: `E_WEAKNESS_EVASIVE`
  - `session.state` は `SCORING` を維持

### AT-03: Round 2 で改善を反映して提出した際の正常 FINAL
- **呼出し**:
  - `artifact_commit` (expected_round: 2, addresses: ["interface_completeness"])
  - `score_submit` (expected_round: 2, 全基準 score: 9)
- **期待値**:
  - サーバ応答: `ok: true`, `verdict: "FINAL"`, `verdict_reason: "all_criteria_passed"`
  - `session.state`: `FINAL`

---

## 15. 自己適用記録 (Self Hosting)

- **Round 1 の自己批判・減点**:
  - 初期ドラフトに対し、`interface_completeness` (6点), `host_portability` (6点), `acceptance_tests` (6点), `state_machine` (7点), `anti_gaming` (7点) の減点と具体的 Weakness を指摘。
  - サーバから `verdict: "ITERATING"`（Round 2）および `must_fix` 3件を受領。
- **Round 2 での解消差分**:
  - `interface_completeness`: 新規エラーコードの詳細 JSON Schema（`detail`）を定義。
  - `host_portability`: Antigravity 二相プロトコルおよび Windows pwsh 規約を策定。
  - `acceptance_tests`: AT-01〜AT-03 の呼び出し列・引数・期待値を具体化。
  - `state_machine`: 全状態×全ツールの遷移マトリクス表を完備。
  - `anti_gaming`: 逃避 Weakness 検知用の正規表現ブラックリストを確定。

---

## 16. 却下代替案 (Rejected Alternatives)

- **代替案1: プロンプトでの注意喚起の強化 (Soft Prompting)**:
  - 理由: 既に先行改善で実施されたが、Antigravity（Gemini等）において Round 1 全項目9点での即時終了が再発したため却下。
- **代替案2: Antigravity でのサブエージェント擬似エミュレーション**:
  - 理由: Antigravity ハーネス側に `Agent()` や `invoke_subagent` の実行ツールが存在しないため、存在しないツールを前提とするアプローチは根本的に不可。
- **代替案3: クライアント側 MCP プロキシによる強制書き換え**:
  - 理由: クライアントの構成が複雑化しポータビリティを損なうため、strict-goal MCP サーバ自身の判定エンジン（`engine.js` / `score_submit.js`）で一元的に強制する方式を採用。

# strict-goal design レビュー改善・トークン最適化 実装計画

## 1. 目的

`strict-goal design` の基本的な設計矛盾の見逃しを減らしつつ、ラウンド数、非キャッシュ入力、出力、課金比較用 `Billed Total` を増やさない。

成功条件は「レビュー文章を増やすこと」ではなく、以下を同時に満たすこととする。

- `spec_strict_goal7.md` で確認された7種類の欠陥を、FINAL前に検出する。
- 欠陥のない対照仕様に、件数合わせの偽陽性 `must_fix` を発生させない。
- 既存8基準の件数、重み、合格条件、FSM、`score_submit` スキーマを変更しない。
- 比較ベンチマークで、中央値の `Billed Total` とラウンド数を基準値以下にする。

## 2. 方針

1. 新しい基準を追加せず、既存基準のアンカーを具体化する。
2. 「欠陥を最低3件挙げる」ではなく、3種類の反例プローブを実行し、成立した欠陥だけを報告する。0件を許可する。
3. 自由記述を増やさず、検証結果を有界JSONと1本の検証コマンドに集約する。
4. ラウンド2以降は全文マトリクスを作らず、変更差分に限定した影響情報だけをファイルへ保存する。
5. 親へは `skill_state`、証拠ファイルのパス、短い結果だけを返し、仕様全文・ログ・マトリクスを再送しない。

## 3. 実装タスク

### T001: ベースラインと回帰用コーパスを固定

対象:

- `scripts/measure-design-review-token-effect.mjs`（新規）
- `strict-goal/server/test/fixtures/design-review/`（新規）
- `docs/strict-goal-design-review-analysis.md`

作業:

- `spec_strict_goal7.md` の7欠陥を個別fixtureとして固定する。
- 修正済み対照fixtureも用意し、偽陽性を測定できるようにする。
- 実行ごとに `rounds`、サブエージェント数、Cached Input、Uncached Input、Output、Billed Total、All Processed、見逃し数、偽陽性数をJSONで記録する。
- 初回は1ケースのcanary、通過後だけ複数ケースを実行し、評価自体の浪費を防ぐ。

完了条件:

- 変更前の同一モデル・同一プロンプト・同一上限で基準値を保存できる。
- キャッシュ入力と課金比較用トークンを混同せず別列で出力する。

### T002: 8基準を維持したままアンカーを先鋭化

対象:

- `strict-goal/presets/design.json`
- `strict-goal/server/test/presets.test.js`

変更:

- `internal_consistency` に以下を統合する。
  - Options・公開API・既定値表・本文で使う設定名の集合一致。
  - 拒否、削除、退去など相互排他的な方針が同時定義されていないこと。
  - 同期シグネチャと非同期実行方式の一致。
  - データ構造の実操作と記載された最悪計算量の一致。
- `numeric_roundtrip` は単一式への代入ではなく、状態スライドを含む遷移を必須化する。
  - 返却待機時間の1ms前では拒否。
  - 返却待機時間後では許可。
  - ウィンドウ境界を跨ぐ場合は、`current -> previous` の遷移後に再評価。
- `interface_completeness` は宣言だけでなく、公開オプションとメソッドを使用する最小consumerまたは契約テストの実行を要求する。
- 新しい `algorithm_soundness` 基準は追加しない。計算量は `internal_consistency`、状態遷移は `numeric_roundtrip` へ吸収する。

完了条件:

- criteria数は8、ID集合、weight、priority、policyは変更前と同一。
- 7欠陥が既存基準のいずれかへ一意に割り当てられる。
- `presets.test.js` がアンカーの必須句と基準数不変を検証する。

### T003: Verifierの反例探索を有界化

対象:

- `strict-goal/agents/sg-verifier.md`
- 配布コピー: `.agents/agents/sg-verifier.md`、`.claude/agents/sg-verifier.md`、`.codex/agents/sg-verifier.toml`
- `strict-goal/skills/strict-goal/SKILL.md` と配布コピー

Verifierに課す3プローブ:

1. `time_state_trace`: 時刻経過、境界、返却待機時間後の状態遷移。
2. `policy_trace`: 上限到達時などの分岐順序と相互排他性。
3. `complexity_trace`: データ構造操作から導出した最悪計算量。

出力契約:

```json
{
  "probes": [
    { "id": "time_state_trace", "outcome": "pass|fail", "criterion_id": "numeric_roundtrip", "evidence": "240文字以内" },
    { "id": "policy_trace", "outcome": "pass|fail", "criterion_id": "internal_consistency", "evidence": "240文字以内" },
    { "id": "complexity_trace", "outcome": "pass|fail", "criterion_id": "internal_consistency", "evidence": "240文字以内" }
  ]
}
```

制約:

- `fail` の件数に最低値を設けない。全プローブ `pass` を許可する。
- 同じ欠陥を複数基準の `must_fix` として重複報告しない。
- 仕様書は1回だけ読み、検証スクリプトは1本、実行は1回とする。
- プローブ結果は既存scoreの根拠へ再利用し、追加の採点ターンを作らない。

### T004: Executable ContractをLLM採点前の1回に集約

対象:

- `strict-goal/server/helper.js`
- `strict-goal/server/test/helper.test.js`
- `strict-goal/agents/sg-verifier.md`

作業:

- `helper.js design-check <artifact> <check-command>` を追加する。
- 既存 `test-run` と同様に、終了コード、stdoutの短いラベル行、ハッシュを有界JSONへ正規化する。
- Verifierは一時的なconsumer／状態遷移スクリプトを `.strict-goal/evidence/<session>/<round>/` に作る。
- 1回のコマンドで次を検査する。
  - 公開型・オプションを使う最小consumer。
  - 既定値とエラー条件。
  - 境界前後を含む状態遷移。
  - 仕様に記載した計算量を成立させるデータ構造操作の確認。
- `tsc` 等が対象プロジェクトに存在する場合だけ型検査を使う。ネットワーク経由の都度インストールは禁止する。
- コンパイラが無い場合は自己完結したNode契約テストへフォールバックし、未検証項目を成功扱いしない。

完了条件:

- 成功時の親向け出力は、コマンド、exit code、ラベル別pass/fail、ハッシュだけ。
- 生ログと生成スクリプト本文を親プロンプトへ戻さない。
- `maxKeys`欠落、同期API内の非同期戻り、境界後の再拒否をfixtureで検出する。

### T005: Ripple-effect Auditを差分JSONへ縮小

対象:

- `strict-goal/agents/sg-worker.md`
- `strict-goal/agents/sg-verifier.md`
- 各配布コピー
- `strict-goal/skills/strict-goal/SKILL.md`

ラウンド2以降、Workerは意味的契約を変更した場合だけ次を保存する。

```json
{
  "changed_contracts": ["最大3件"],
  "affected_sections": ["最大5件"],
  "checks": ["最大3件"],
  "unresolved": ["最大2件"]
}
```

保存先は `.strict-goal/evidence/<session>/<round>/impact.json` とする。Verifierはファイルを読み、記載されたcheckをT004の1本のスクリプトへ統合する。

禁止事項:

- 仕様全文との総当たりマトリクス。
- 変更のない節の再説明。
- WorkerとVerifierによる同じ影響説明の二重生成。
- `impact.json` 本文を親へ返すこと。

### T006: 状態受け渡しとプロンプト予算を固定

対象:

- `strict-goal/skills/strict-goal/SKILL.md`
- `strict-goal/server/src/skill_state/projector.js`
- `strict-goal/server/test/skill_state_projector.test.js`

作業:

- 親から子へ渡す情報を `{skill_state, transaction, paths, output_contract}` に限定する既存規約を維持する。
- `skill_state` へ全文のプローブ結果やimpact JSONを埋め込まない。失敗したprobe ID、criterion ID、証拠パスのみを保持する。
- 1トランザクションの返却サイズ上限をテストで固定する。
- 同一子の再利用、仕様全文、過去ログ、ルーブリック全文の再送を禁止する。

完了条件:

- 既存4,000文字上限を超えない。
- 次ラウンドのWorkerが、`must_fix` と証拠パスだけで修正を開始できる。

### T007: 回帰テストとトークンA/B判定

実行順:

1. unit test: preset、helper、projector、プロンプト同期。
2. defect fixture: 7欠陥が適切な既存基準で9未満になること。
3. clean fixture: 3プローブがpassし、件数合わせの欠陥が生成されないこと。
4. canary A/B: 同一プロンプト1件。
5. canary合格後のみ、固定コーパスで複数回比較。

リリースゲート:

- 致命的欠陥の見逃し: 0件。
- clean fixtureの偽陽性 `must_fix`: 0件。
- 中央値ラウンド数: baseline以下。
- 中央値Billed Total: baseline以下。
- 中央値Output: baseline以下。
- All Processedが10%以上増えた場合は、A/Cの記述量を再削減して再測定する。

## 4. 依存関係

```text
T001 ─┬─> T002 ─> T003 ─┬─> T006 ─> T007
      └────────> T004 ──┤
                 T005 ──┘
```

T002〜T005は個別feature flagまたは独立コミットにし、A/Bで悪化した処方だけを戻せるようにする。

## 5. 実装順の推奨

1. T001で測定可能にする。
2. 低コストで効果が高いT002とT004を先行導入する。
3. T003は「最低3件」ではなく「3プローブ・0件可」で追加する。
4. T005はラウンド2以降かつ意味的変更時だけ有効化する。
5. T006でコンテキスト再送を抑止する。
6. T007のゲートを満たした処方だけ残す。

## 6. 非対象

- rubric基準数の増加。
- `score_submit` やFSMの新状態追加。
- Verifierを複数体並列起動する多数決。
- 毎ラウンドの全文再レビュー。
- 実行時に`npx`で依存関係を取得する検証。

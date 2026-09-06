# チェーン予算（chain_round_budget）と grantExtraRounds の結線実装計画

## 概要
`score_submit` におけるチェーン全体のラウンド予算チェック（設計書 §13 AT-16, §19.10.2）、および `escalate(action:"resolve", resolution:"continue")` におけるチェーン予算上乗せ（`grantExtraRounds` による +6周、1チェーン1回限り）を `rubric-loop-agy` の実装を参考に `strict-goal/server` へ移植・結線します。

---

## ユーザ確認事項
> [!NOTE]
> - `score_submit` でチェーン予算（既定28周）に達した際、**不合格判定**の場合は `verdict: "REVISE"`, `state: "ESCALATED"`（reason: `"chain_budget_exhausted"`）となり人間へのエスカレーションが発生します。すでに上乗せ済み等で再度枯渇した場合は `E_CHAIN_BUDGET_EXHAUSTED` 例外がスローされます。
> - **合格判定**（FINAL）の場合は、予算を超過していても合格を潰さず `FINAL` を維持し、`warnings: ["chain_budget_exceeded"]` を付与します（設計書 §19.10.2 の「予算超過で合格を潰さない」原則）。
> - `escalate(continue)` では、チェーン予算枯渇時または超過時に `grantExtraRounds` を呼び出してチェーン全体の上限を +6周 拡張します（1チェーン1回限り。2回目は `E_RESOLUTION_NOT_APPLICABLE`）。

---

## 変更対象ファイルと詳細

### 1. `strict-goal/server/src/tools/score_submit.js`
- `chainExists`, `readChain` (`../chain/store.js`) および `computeChainRounds`, `effectiveRoundLimit` (`../chain/budget.js`) をインポート。
- 採点判定後、セッションがチェーンに属している場合にチェーン全体の累計ラウンド数を集計し、実効上限（`chain_max_rounds + granted_extra_rounds`）と比較。
- **合格時**: `warnings.push('chain_budget_exceeded')`、`session.state = verdict`。
- **不合格時**:
  - 既に `granted_extra_rounds > 0` かつ上限超過、または大幅超過の場合は `fail('E_CHAIN_BUDGET_EXHAUSTED', ...)`。
  - 初回枯渇時は `effectiveVerdict = 'REVISE'`, `effectiveVerdictReason = 'chain_budget_exhausted'`, `session.state = 'ESCALATED'`, エスカレーショントークンを発行。
- レスポンスエンベロープに `warnings` および `escalation` 情報を正しく格納。

### 2. `strict-goal/server/src/tools/escalate.js`
- `chainExists`, `readChain` (`../chain/store.js`) および `computeChainRounds`, `effectiveRoundLimit`, `grantExtraRounds` (`../chain/budget.js`) をインポート。
- `applyResolution` または `action: 'resolve'`（および MRTR 往復時）の `resolution === 'continue'` 処理において:
  - チェーンが存在し、予算枯渇（`chainRounds >= effectiveLimit` または直前判定が `chain_budget_exhausted`）の場合、`grantExtraRounds(dataDir, session.chain_id)` を呼び出す。
  - 更新されたチェーン情報 `{ limit, granted_extra_rounds }` をレスポンスの `chain` プロパティに含める。
  - 2回目の continue 呼び出し時は `grantExtraRounds` 内部で `E_RESOLUTION_NOT_APPLICABLE` (`detail.reason: 'extra_rounds_already_granted'`) がスローされる。

### 3. `strict-goal/server/src/errors/codes.js`
- `TOOL_ERRORS.score_submit` に `'E_CHAIN_BUDGET_EXHAUSTED'` を追加（17件 → 18件）。

### 4. `strict-goal/server/test/error_codes.test.js`
- `TOOL_ERRORS.score_submit.length` の期待値を 17 → 18 に更新。

### 5. `strict-goal/server/test/errors_score_submit.test.js`
- `E_CHAIN_BUDGET_EXHAUSTED` が `score_submit` から正しくスローされるテストケースを追加。

### 6. `strict-goal/server/test/at_16.test.js`
- モックやモジュール直接呼び出しで回避していたテストを、設計書 §13 AT-16 の真のエンドツーエンド検証へ刷新:
  1. chain rounds が合計 28周 に達した状態での不合格提出 → `verdict: "REVISE"`, `state: "ESCALATED"`, `reason: "chain_budget_exhausted"`
  2. `escalate(resolve, continue)` → limit 28 → 34, `granted_extra_rounds: 6`, `state: "DRAFTING"`
  3. 2回目の `continue` → `E_RESOLUTION_NOT_APPLICABLE` (`extra_rounds_already_granted`)
  4. 対照検証: 予算超過時でも合格していれば `FINAL` を維持し `warnings: ["chain_budget_exceeded"]`

### 7. `CLAUDE.md`
- ハマりポイントの「AT-16 未結線」記述を「結線・解消済み」に更新。

---

## 検証手順
1. `npm test test/at_16.test.js` で AT-16 のシナリオが完走することを確認。
2. `npm test test/error_codes.test.js` および `npm test test/errors_score_submit.test.js` でエラーレジストリ整合性を確認。
3. `npm test` で全 449+ 件のテストスイートが 100% 通過（回帰なし）することを確認。

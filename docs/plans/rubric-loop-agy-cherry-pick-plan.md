# rubric-loop 修正計画（agy からのチェリーピック＋F13 修正）

**Goal:** ベース実装 `rubric-loop` に agy 由来の3機能を移植し、残存する F13 テスト失敗を解消して全件緑にする。

**前提（実測済み）:**
- `rubric-loop`: 434件中432 pass・1 fail（F13 のみ）・1 skip。stdio 実機で `initialize`→`tools/list`→`tools/call loop_open` が通る。
- `rubric-loop-agy`: 参照専用。**一切変更しない。** 読み取り元パスは `rubric-loop-agy/server/...`。
- agy の `artifact_commit` と rl の同ファイルは構造が分岐している（agy: kind 分岐／rl: content-files 分岐）。plan 分岐の丸写しは不可で、rl の content 系への適応が要る。
- コミット前のステージングは必ずユーザーの許可を取る（メモリ合意事項）。本計画の実施者はコミットせず、検証結果を報告して停止する。

**変更ファイル一覧（全6件）:**
- 修正: `rubric-loop/server/test/failure_modes_11_20.test.js`（A）
- 修正: `rubric-loop/server/src/tools/artifact_commit.js`（B）
- 修正: `rubric-loop/server/src/errors/codes.js`（B）
- 修正: `rubric-loop/server/src/tools/escalate.js`（C）
- 修正: `rubric-loop/server/src/mcp/envelope.js`（C）
- 修正: `rubric-loop/server/test/at_12.test.js`（C、workaround 除去）
- 新規: `rubric-loop/server/verify_audit.js`（D）
- 修正: `rubric-loop/server/src/tools/score_submit.js`（D、record に1行追加）
- 新規: `rubric-loop/server/test/verify_audit.test.js`（D）
- 追加: B・C 用の新規テスト（既存 `artifact_commit.test.js`／`errors_rest.test.js`／`escalate_core.test.js` のいずれかに追記）

---

## Task A: F13 テストの日英両対応（1 fail 解消）

**Objective:** 英語化 SKILL.md に対して F13 の正規表現を日英両対応にする。

**Files:**
- Modify: `rubric-loop/server/test/failure_modes_11_20.test.js:200`

**Step 1: テストを修正**

```js
assert.match(skill, /FINAL を名乗らない|forbidden from declaring FINAL/);
```

（現行 `assert.match(skill, /FINAL を名乗らない/);` の置換。SKILL.md 本文側は変えない。199行目と201–203行目は英語版でも通過することを Step 2 で確認する）

**Step 2: 実行して確認**

Run: `cd rubric-loop/server && node --test test/failure_modes_11_20.test.js`
Expected: 全件 PASS（F13 を含む）

---

## Task B: plan 検証の結線（E_PLAN_SCHEMA／E_PLAN_INVALID／E_PLAN_DESIGN_REF）

**Objective:** `artifact_kind:"plan"` の content commit 時に plan 検査をかける。現状は plan モードが任意文字列を通す。

**Files:**
- Modify: `rubric-loop/server/src/tools/artifact_commit.js`（import 3行＋分岐5行）
- Modify: `rubric-loop/server/src/errors/codes.js`（`TOOL_ERRORS.artifact_commit` に3件追加）
- Test: `rubric-loop/server/test/` 内の既存 plan／artifact 系テストに追記

**Step 1: import を追加**（現行15行目 `checkAssertMutation` の次）

```js
import { parsePlanContent } from '../artifact/plan_schema.js';
import { checkPlan } from '../artifact/plan_checks.js';
import { checkDesignRefs } from '../artifact/design_refs.js';
```

（3モジュールは rl 側に同名 export で存在済み。新規作成は不要）

**Step 2: content 分岐に plan 検査を挿入**（現行144–145行目、`else {` の直後、`saveContentArtifact` の直前）

```js
    } else {
      if (session.artifact_kind === 'plan') {
        const plan = parsePlanContent(input.content);
        checkPlan(plan);
        if (session.upstream) {
          checkDesignRefs(dataDir, plan, session.upstream);
        }
      }
      ({ digest, bytes } = saveContentArtifact(sDir, session.artifact_kind, input.content));
```

（agy 版 lines 100–119 の移植だが、agy の `planChecks` 変数・fileset 分岐は持ち込まない。出力スキーマ §6.4.3 に `plan_checks` は無いので成功時の出力変更は無し＝検証のみ。YAGNI）

**Step 3: エラー台帳に再登録**（`codes.js` の `artifact_commit` 配列、現行80–94行目。定義本体33–35行目は残存）

```js
    'E_PLAN_SCHEMA',
    'E_PLAN_INVALID',
    'E_PLAN_DESIGN_REF',
```

**Step 4: テストを追加**（TDD: 先に書いて fail を確認）

- 循環依存 plan → `E_PLAN_INVALID`
- JSON 不正 content → `E_PLAN_SCHEMA`
- `design_refs` が上流に存在しない → `E_PLAN_DESIGN_REF`（plan セッションは FINAL済み design にピン留めが必要。作り方は `at_*.test.js` の連鎖手順を参照）
- 正常 plan → 受理（回帰防止）

**Step 5: 実行して確認**

Run: `cd rubric-loop/server && node --test test/artifact_commit.test.js test/errors_artifact_commit.test.js test/error_codes.test.js`
Expected: 全件 PASS（`error_codes.test.js` は台帳と実装の一致を見るため Step 3 忘れがあるとここで落ちる）

---

## Task C: `escalate(action:"reopen")` の実装

**Objective:** `FINAL`→`DRAFTING` の再オープンを公開ツール経由で可能にし、at_12 の session.json 直接書き換え workaround を消す。

**Files:**
- Modify: `rubric-loop/server/src/tools/escalate.js`（分岐追加、153行目 `else {` の直前）
- Modify: `rubric-loop/server/src/mcp/envelope.js`（`reopened` 受け渡し2行）
- Modify: `rubric-loop/server/test/at_12.test.js`（workaround 除去＋公開ツール経由に書換え）
- Test: 非 FINAL からの reopen → `E_STATE_VIOLATION` を追加

**Step 1: reopen 分岐を挿入**（`kickback` 分岐の次、最終 `else` の前）

```js
    } else if (input.action === 'reopen') {
      if (session.state !== 'FINAL' && session.state !== 'FINAL_WITH_RELAXATION') {
        fail('E_STATE_VIOLATION', 'reopen is only valid in FINAL or FINAL_WITH_RELAXATION', {
          state: session.state,
        });
      }
      const previousFinalDigest = session.current_artifact?.digest ?? null;
      session.state = 'DRAFTING';
      session.round += 1;
      session.reopened = [
        ...(session.reopened ?? []),
        { at: new Date().toISOString(), by: 'human', reason: input.note, previous_final_digest: previousFinalDigest },
      ];
      // A10: FINAL からは request_human を経由できずペンディングトークンが存在し得ないため、
      // kickback と同じく実トークン照合はせず system event を記録する（存在検査は assertActionInputs 済み）。
      const { record } = recordSystemEvent(sDir, { reason: 'reopen', resolution: 'reopen' });
      escalationInfo = toEscalationInfo(record, '');
    } else {
```

（`recordSystemEvent`・`toEscalationInfo` は import・定義済み。新規 import 不要。`human_token` の存在検査は `assertActionInputs` 47–49行目に存在済み。FSM は `states.js:76,85` で FINAL 系からの reopen を許可済みなので FSM 変更不要。`TOOL_ERRORS.escalate` への追加コードは不要＝`E_STATE_VIOLATION` は登録済みのはず。Step 4 の `error_codes.test.js` で裏取りする）

**Step 2: envelope に `reopened` を追加**（`escalation` と同じパターン）

- 分割代入部（42行目付近）に `reopened,` を追加
- `if (escalation !== undefined) envelope.escalation = escalation;`（79行目）の次に追加：

```js
  if (reopened !== undefined) envelope.reopened = reopened;
```

- `escalate.js` の `buildEnvelope({...})` 呼び出し（160–169行目）に `reopened: session.reopened,` を追加

**Step 3: at_12 の workaround を公開ツール経由に書換え**

- `at_12.test.js` の `writeSessionRaw` による「reopen 相当」再現（184–199行目付近）を `escalate({input:{..., action:'reopen', human_token:'...'}, persistence})` に置換
- 先頭コメント2–3行目（「reopen(T042)は未実装のため」）を更新
- agy 版 at12 Step-1 の表明を移植：`state === 'DRAFTING'`、`round` が +1、`reopened[0].previous_final_digest` が再オープン前の digest と一致

**Step 4: 実行して確認**

Run: `cd rubric-loop/server && node --test test/at_12.test.js test/at_13.test.js test/escalate_core.test.js test/error_codes.test.js test/fsm.test.js`
Expected: 全件 PASS

---

## Task D: `verify_audit.js` の移植（バグ修正込み）

**Objective:** 監査 JSON の再検証 CLI（§12.3 の機械化）を追加する。agy 版の rubric lookup バグは修正して持ち込む。

**Files:**
- Create: `rubric-loop/server/verify_audit.js`（agy 版コピー＋1行修正）
- Modify: `rubric-loop/server/src/tools/score_submit.js`（record に `rubric_version` 1行追加）
- Create: `rubric-loop/server/test/verify_audit.test.js`（agy 版をパスそのまま移植。相対配置が同一のため import は無変更で動く）

**Step 1: 本体をコピーし、rubric lookup を修正**

agy 版19行目：

```js
    const rubric = rubricById.get(round.round) ?? auditData.rubric_versions?.[auditData.rubric_versions.length - 1];
```

移植版：

```js
    const rubric = rubricById.get(round.rubric_version ?? round.round) ?? auditData.rubric_versions?.[auditData.rubric_versions.length - 1];
```

（`round.round` を版番号と混同する latent bug の修正。`?? round.round` は旧 audit への後方互換。CLI ブロック末尾の exit 0/1/2 はそのまま移植）

**Step 2: round record に `rubric_version` を保存**（`score_submit.js` 203–213行目の record 構築部）

```js
      const record = {
        round: scoredRound,
        rubric_version: session.rubric_version,
        submission_id: input.submission_id,
```

（rl の `rubric_versions` 出力は `{version, criteria}` を持つため `verifyAudit` の読みと整合する。`weighted_mean`・`min_score`・`evidence_digests` も記録済みで不足なし）

**Step 3: テストを移植して実行**

Run: `cd rubric-loop/server && node --test test/verify_audit.test.js`
Expected: 3件 PASS（正常0・改竄1・artifact無し検証）

---

## 全体検証（最後に1回）

Run: `cd rubric-loop/server && node --test`
Expected: `pass` が総数と一致し `fail 0`（現状の1 fail が Task A で消え、B–D の新規分も緑）。`skipped 1` は既存のまま残ってよい。

加えて stdio 実機スモーク（評価時と同一手順）で `initialize` が `-32601` になっていないことを確認する。

## スコープ外（やらない）

- `rubric-loop-agy/` への変更（参照専用）
- agy 側の残存 6 fail（SKILL 日英）の修正
- `chain_v2.js` の agy 流 `schema` 追加、`envelope.js` の agy 流フィールド追加
- `verify_audit` の検証範囲拡大（verdict 逻辑の再計算は含めない）
- コミット・ステージング（検証後に報告して停止し、許可を待つ）

# 実装計画: スコープ遵守と計算検証の強制 — ルーブリック改善

> このファイルは `docs/plans/impl-plan-rubric-scope-and-verification.plan.json` から `node scripts/render-plan-md.mjs` で生成した派生物。
> 編集は JSON 側に行い、本ファイルは再生成する（`--check` で差分を検出できる）。

| 項目 | 値 |
|---|---|
| 上流設計書 | `docs/plans/design-rubric-scope-and-verification.md` |
| plan_version | 1 |
| タスク数 | 14 |
| 見積ラウンド合計 | 24 |
| 受け入れ条件 / 検証コマンド | 61 件 / 32 件 |
| JSON sha256 | `786285330ab6d3d5ad7d20ef514e878239c3767c96dffdd6e0f3a5f1d260fceb` |

## 方針

設計書『スコープ遵守と計算検証の強制 — ルーブリック改善設計』の改善1〜7と§5の計測を、設計書§4の適用順序（3→5→1→7→4→2→6）に沿って14タスクへ分解した実装計画。順序の根拠は2点ある。第一に、改善3・改善5はプリセットJSONへの基準追加のみでサーバ改修がゼロであり、費用対効果が最も高いので最前に置く。第二に、最も不確実性が高く後戻りコストが大きいのは既定designプリセットの中身を汎用8基準へ入れ替える工程（既存テストpresets.test.jsの件数アサーション（T002 完了時点で17件）を直接壊す）であり、依存が許す限り前倒しして実行順14タスク中の4〜5番目（T001→T002→T003→T004→T014）に置いた。改善単位で見れば設計書§4の適用順序どおり3番目の改善であり、改善1がプリセット解決経路の一般化（T003）・ハーネス用プリセットの新設（T004）・既定プリセットの置換（T014）の3タスクに割れているため、タスク列の位置は4〜5番目になる。新設と置換を分けたのは、置換で問題が出たときT004完了地点まで戻れば既存の非汎用ルーブリック（T004完了時点で17基準）の挙動が無傷で残り、後戻りの単位が1ファイル＋テスト期待値に閉じるためである。警告系（改善4b・2・6）は誤検知調整が要り効果が弱いため後段に集約し、いずれもartifact_commit.jsのwarnings生成部を触るため直列化して衝突を避ける。各タスクは完了時点でnode --testが緑であることを受け入れ条件に含め、途中で停止しても常にテスト緑の地点が残るようにした。

## 実行順と依存

| # | id | タイトル | 依存 | 後続 | 変更 | 受入 | 検証 | 見積 |
|---|---|---|---|---|---|---|---|---|
| 1 | T001 | 改善3: numeric_roundtrip 基準を design プリセットへ追加 | — | T002 | 2 | 4 | 2 | 1 |
| 2 | T002 | 改善5: defense_tradeoffs 基準を design プリセットへ追加 | T001 | T003 | 2 | 3 | 2 | 1 |
| 3 | T003 | 改善1a: プリセット解決をモード名からプリセット名へ一般化 | T002 | T004 | 3 | 5 | 2 | 2 |
| 4 | T004 | 改善1b: ハーネス設計用プリセット design.harness.json の新設 | T003 | T014, T012 | 2 | 4 | 2 | 2 |
| 5 | T014 | 改善1c: 既定 design プリセットを汎用8基準へ置換 | T004 | T005 | 2 | 4 | 2 | 2 |
| 6 | T005 | 改善7a: criteria への priority フィールド追加と永続形への配線 | T014 | T006 | 4 | 5 | 2 | 2 |
| 7 | T006 | 改善7b: buildMustFix を priority 優先の並びに変更し design プリセットへ priority を割当 | T005 | T007 | 3 | 4 | 2 | 2 |
| 8 | T007 | 改善4a: self_hosting のアンカー9を追記報酬から本文反映要求へ反転 | T006 | T008 | 2 | 3 | 2 | 1 |
| 9 | T008 | 改善4b: 末尾追記節に appendix_accretion 警告を追加 | T007 | T009 | 4 | 5 | 2 | 2 |
| 10 | T009 | 改善2: policy.scope_guard_terms と out_of_scope_section 警告 | T008 | T010 | 5 | 5 | 2 | 2 |
| 11 | T010 | 改善6: policy.artifact_budget_bytes と over_budget 警告 | T009 | T011 | 5 | 4 | 2 | 2 |
| 12 | T011 | §5: 効果測定スクリプトの整備 | T010 | T013 | 2 | 5 | 2 | 2 |
| 13 | T012 | 層C: SKILL.md のモード選択表へプリセット選択の1行を追加 | T004 | T013 | 2 | 3 | 2 | 1 |
| 14 | T013 | 全体回帰と未決事項の明文化 | T011, T012 | — | 3 | 7 | 6 | 2 |

## 前提・制約

1. 設計書§3の各『決定』（拒否/警告/記録）をそのまま実装する。警告と決めた機構を拒否に格上げしない。
2. 設計書が挙げていないが実装上必須の配線として、priorityフィールドはsrc/rubric/from_input.jsのconvertInputCriterionにも通す必要がある（現行は未知フィールドを落とすため、プリセットのpriorityが永続rubricに届かない）。同様にpolicyの新キー（scope_guard_terms/artifact_budget_bytes）はsrc/rubric/schema.jsとschemas/tools.jsonの両方がadditionalProperties:falseのため両方に追加する。
3. presets/design.jsonの基準数変更はserver/test/presets.test.jsの件数・auto比率アサーションを壊すため、プリセットを触る全タスクが同テストの更新を含む。
4. 設計書『範囲外・未決事項』の9項目は本計画では実装しない。T013でdocs/plans配下に未決事項として明文化するに留める。
5. §5の効果測定はスクリプト整備までを本計画の範囲とし、5群×全課題のベンチマーク再実行そのものは人間が別途起動する運用とする。
6. scripts/verify-critique-claims.sh は改訂『前』の状態を固定した証拠スクリプトであり、C2（design 15基準一致）・C6（buildMustFix のスコア昇順）・C7（警告4種）・C9（auto 3件）は本計画の実装で必ず不成立になる。T013 で改訂前の主張である旨を注記したうえで期待値を再ベースラインする。
7. 設計書の見出しとタスクの対応（実装不要の宣言を含む）: 1.1→T004 / 1.2→T006 / 1.3→T010 / 2.拘束力の3層→T012 / 改善1→T003・T004・T014 / 改善2→T009 / 改善3→T001 / 改善4→T007・T008 / 改善5→T002 / 改善6→T010 / 改善7→T005・T006 / 相互作用→T013 / 4.変更一覧→T013 / 5.効果の測り方→T011。文書タイトルと「範囲外・未決事項」の2見出しは実装不要（後者は9項目とも未決のまま T013 で明文化する）。この対応は scripts/check-plan-coverage.mjs の検査Aが機械的に再検証し、対応の無い見出しが1つでもあれば終了コード1になる。
8. 本計画の自己検査として scripts/check-plan-coverage.mjs（設計書の見出し・名指しファイルの網羅と design_refs の意味的整合）と scripts/check-plan-verify-order.mjs（各タスクの検証コマンドが、そのタスクと先行タスクだけを適用した中間状態で参照先ファイルを解決できるか）を用意した。実装記録を書き起こす T013 でも両者を再実行し、実装後も対応表が崩れていないことを終了コードで確認する。
9. 取り下げ（ロールバック）の単位: 新規追加ファイル（presets/design.harness.json・src/artifact/heading_scan.js・scripts/measure-rubric-effect.sh とそれぞれの新規テスト）は削除するだけで直前タスクの完了地点に戻る。既存ファイルを改変するタスクは changes に挙げた最大5ファイルの revert で戻る。全タスクが完了時点で node --test 緑を受け入れ条件に含むため、復帰点は常に「直前タスクの完了地点」であり、途中で中断しても緑の状態が残る。
10. T011 の scripts/measure-rubric-effect.sh と test/measure_script.test.js は、サーバ本体のどのモジュールからも import されず、他タスクの受け入れ条件・検証コマンドからも参照されない独立2ファイルである。測定方法が不適切と判明した場合はこの2ファイルを削除するだけで T010 完了地点へ戻り、改善1〜7の実装には一切影響しない。
11. T013 の CLAUDE.md への追記だけは上流設計書由来ではなく、本リポジトリの CLAUDE.md「知見の記録ルール」（また踏むバグ・罠はハマりポイントへ追記）が課す運用義務に基づく。設計書のスコープを広げる意図はなく、対象は本実装で実際に踏んだ2点（priority を from_input.js に通さないと落ちる件、プリセット基準数と presets.test.js の連動）に限定し、新機能・新方針は書かない。
12. presets/design.json の基準数は実行順に沿って 15（現状）→16（T001 で numeric_roundtrip 追加）→17（T002 で defense_tradeoffs 追加）→8（T014 で汎用8基準へ置換）と推移する。design.harness.json は T004 で17件として新設され、以後件数は変わらない。各タスクの受け入れ条件・検証コマンドに書く件数は、設計書に載っている「15 基準」ではなく、このタスク到達時点の累積値を使うこと。presets.test.js の件数アサーションも T001・T002・T004・T014 の4タスクで順に更新する。
13. 本計画は上流 design 成果物 docs/plans/design-rubric-scope-and-verification.md を一切書き換えない。この md の sha256 は plan セッションがピンした f0341784676b40db38f0fc928bd957185f76e959f43fc6fd00be7fd6608e2b1f と同一であり、1バイトでも変えると上流ピンが drift して本セッションが SUPERSEDED 化し、escalate(rebase) と再採点が必要になる。実装位置の対応表・未決事項・判明した知見は、それぞれ新規の docs/plans/impl-record-rubric-scope-and-verification.md と既存の CLAUDE.md（リポジトリの知見記録ルール）に書き、T013 の検証コマンドで上流 md の sha256 不変を機械確認する。

## タスク詳細

### T001: 改善3: numeric_roundtrip 基準を design プリセットへ追加

- **依存**: なし（起点）　**後続**: T002　**見積**: 1 ラウンド

**意図**

本文の数式を境界値で検算し往復チェックを1本要求する基準を、verification:"auto" で追加する。既存の require_command_evidence_for:["auto"] により command 根拠の添付が強制されるため、サーバ側の新規コードは書かない。

**設計書の根拠 (design_refs)**

- `### 改善3: `numeric_roundtrip` 基準 — 層B（新規コード不要）`
- `**変更対象**: `presets/design.json` の criteria 追加のみ。`
- `## 3. 改善案`
- `## 1. 判定サマリ`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/presets/design.json` | numeric_roundtrip を weight 3 / verification auto で追加。anchors は設計書§改善3のブロックをそのまま採用 |
| modify | `strict-goal/server/test/presets.test.js` | criteria 件数 15→16、design の auto 比率 3/15→4/16 へ更新 |

**受け入れ条件**

- [ ] presets/design.json の criteria に id が numeric_roundtrip の要素が1件だけ存在し、weight が 3、verification が auto である
- [ ] numeric_roundtrip の anchors に 1 / 5 / 9 の3キーが揃い、9 が『境界を含む2ケース以上の代入結果』と『往復チェック1本以上』の両方を要求している
- [ ] loadPreset(pluginRoot, 'design') の戻り値が validateRubric を例外なく通る
- [ ] node --test test/presets.test.js が終了コード 0 で通る

**検証コマンド**

1. 件数・auto比率アサーションの更新を確認（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/presets.test.js
   ```

2. 基準の存在と属性を機械検査（期待終了コード 0）

   ```bash
   node -e 'try{const p=JSON.parse(require("fs").readFileSync("strict-goal/presets/design.json","utf8"));const c=p.criteria.filter(x=>x.id==="numeric_roundtrip");process.exit(c.length===1&&c[0].weight===3&&c[0].verification==="auto"?0:1)}catch(e){console.error("verify failed: "+e.message);process.exit(1)}'
   ```

### T002: 改善5: defense_tradeoffs 基準を design プリセットへ追加

- **依存**: T001　**後続**: T003　**見積**: 1 ラウンド

**意図**

防御機構を足すほど加点される anti_gaming の非対称を打ち消すため、追加した各機構の失敗させる正当ケース・代替案・拒否/警告/記録の決定を要求する基準を weight 2 / manual で追加する。

**設計書の根拠 (design_refs)**

- `### 改善5: `defense_tradeoffs` 基準 — 層B`
- `**変更対象**: `presets/design.json` および `presets/design.harness.json` に追加（weight 2, manual）。`
- `これは `anti_gaming`（防御を足すほど加点される）の**非対称を打ち消す対**として置く。`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/presets/design.json` | defense_tradeoffs を weight 2 / manual で追加。design.harness.json 側は T004 で新設時に同時投入する |
| modify | `strict-goal/server/test/presets.test.js` | criteria 件数 16→17、auto 比率 4/17 へ更新 |

**受け入れ条件**

- [ ] presets/design.json に id が defense_tradeoffs の基準が1件存在し、weight が 2、verification が manual である
- [ ] anchors.9 が『追加された全機構に』という条件付きの文言を含み、機構を追加しない設計で空節にならないようになっている
- [ ] node --test test/presets.test.js が終了コード 0 で通る

**検証コマンド**

1. 更新後の件数・比率で通ること（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/presets.test.js
   ```

2. 条件付きアンカーの文言を検査（期待終了コード 0）

   ```bash
   node -e 'try{const p=JSON.parse(require("fs").readFileSync("strict-goal/presets/design.json","utf8"));const c=p.criteria.find(x=>x.id==="defense_tradeoffs");process.exit(c&&c.weight===2&&c.verification==="manual"&&c.anchors["9"].includes("追加された全機構")?0:1)}catch(e){console.error("verify failed: "+e.message);process.exit(1)}'
   ```

### T003: 改善1a: プリセット解決をモード名からプリセット名へ一般化

- **依存**: T002　**後続**: T004　**見積**: 2 ラウンド

**意図**

loadPreset の VALID_MODES（design/plan/implement の3値）をプリセット名の集合へ一般化し、design.harness を受理できるようにする。schemas/tools.json の rubric_preset enum にも同名を追加する。プリセット実体の入れ替えは T004 で行い、本タスクは解決経路だけを開ける。

**設計書の根拠 (design_refs)**

- `- `strict-goal/server/src/rubric/presets.js` — `VALID_MODES`（3値）をプリセット名集合に一般化し、`loadPreset` の `presets/${mode}.json` 解決をプリセット名で行う`
- `- `strict-goal/server/schemas/tools.json:26` — `rubric_preset` の enum に `design.harness` を追加`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/server/src/rubric/presets.js` | VALID_MODES を VALID_PRESETS へ一般化し design.harness を追加。既存 export 名は後方互換のため維持 |
| modify | `strict-goal/server/schemas/tools.json` | loop_open.input.rubric_preset の enum に design.harness を追加 |
| modify | `strict-goal/server/test/presets.test.js` | 未知プリセット名が E_VALIDATION になること、design.harness が解決対象になることのケース追加 |

**受け入れ条件**

- [ ] loadPreset(pluginRoot, 'design.harness') がファイル未設置の段階では E_INTERNAL（preset not found）を投げ、E_VALIDATION にはならない
- [ ] loadPreset(pluginRoot, 'nonexistent') は従来どおり E_VALIDATION を投げる
- [ ] schemas/tools.json の rubric_preset enum が design / plan / implement / design.harness の4値である
- [ ] loop_open の入力検証が rubric_preset:"design.harness" を E_VALIDATION で拒否しない
- [ ] 検証コマンドが schemas/tools.json の実構造（トップレベルは tools キー1つ、その下に loop_open）を前提にしており、未実装時は exit 1、実装後は exit 0 と実際に切り替わる

**検証コマンド**

1. プリセット解決と loop_open 入力検証の回帰（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/presets.test.js test/errors_loop_open.test.js
   ```

2. enum の4値化を機械検査。schemas/tools.json の実構造は { tools: { loop_open: ... } } であり、直下に loop_open は無い（期待終了コード 0）

   ```bash
   node -e 'try{const t=JSON.parse(require("fs").readFileSync("strict-goal/server/schemas/tools.json","utf8"));const lo=t.tools?t.tools.loop_open:t.loop_open;const e=lo.input.properties.rubric_preset.enum;process.exit(e.includes("design.harness")&&e.length===4?0:1)}catch(e){console.error("verify failed: "+e.message);process.exit(1)}'
   ```

### T004: 改善1b: ハーネス設計用プリセット design.harness.json の新設

- **依存**: T003　**後続**: T014, T012　**見積**: 2 ラウンド

**意図**

T004 到達時点の design.json 17基準（現行15 + T001 の numeric_roundtrip + T002 の defense_tradeoffs）を、そのまま design.harness.json として新設する。設計書の「15 基準をそのまま移設」は改善3・改善5を適用する前の件数を指しており、適用順序 3→5→1 に従う本計画では移設時点で17件になる。既定 design.json はこのタスクでは一切触らない。「新設」と「既定の置換」を分けることで、置換で問題が出ても T004 完了地点へ戻れば既存挙動が無傷で残る。

**設計書の根拠 (design_refs)**

- `### 改善1: design プリセットの分割（スコープ適合）— 層B`
- `- 新規 `strict-goal/presets/design.harness.json` ← 現行 `design.json` の 15 基準をそのまま移設`
- `### 1.1 指摘1が「原因診断が浅い」と判定した理由`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| add | `strict-goal/presets/design.harness.json` | T004 到達時点の design.json の全基準をそのまま複製した17基準（現行15 + numeric_roundtrip + defense_tradeoffs）。policy も同一値を複製する |
| modify | `strict-goal/server/test/presets.test.js` | design.harness を検査対象プリセットに追加し17件・auto比率をアサート。design 側の件数アサーション（T002 で17へ更新済み）はこのタスクでは変更しない |

**受け入れ条件**

- [ ] presets/design.harness.json の criteria が、現行 design の15 id に加えて numeric_roundtrip と defense_tradeoffs を含む計17件である
- [ ] design.harness.json が validateRubric を例外なく通り、pass_score / pass_weighted_mean が 9 である
- [ ] loop_open(rubric_preset:"design.harness") で作成したセッションの rubric が17基準を返す
- [ ] presets/design.json はこのタスクでは未変更のまま17件であり、T002 で17へ更新済みの design 件数アサーションが緑のまま通る

**検証コマンド**

1. 新規プリセットの読み込みと既存 design の無改変を同時に確認（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/presets.test.js test/loop_open_create.test.js
   ```

2. 移設漏れ（15 id の欠落）と、改善3・5 で増えた2基準を含む計17件を検査（期待終了コード 0）

   ```bash
   node -e 'try{const h=JSON.parse(require("fs").readFileSync("strict-goal/presets/design.harness.json","utf8"));const base=["failure_mode_mapping","interface_completeness","state_externalized","verdict_ownership","anti_gaming","state_machine","convergence","packaging_conformance","host_portability","responsibility_split","auditability","acceptance_tests","defaults_decided","self_hosting","rejected_alternatives"];const ids=h.criteria.map(c=>c.id);process.exit(base.every(i=>ids.includes(i))&&ids.includes("numeric_roundtrip")&&ids.includes("defense_tradeoffs")&&ids.length===17?0:1)}catch(e){console.error("verify failed: "+e.message);process.exit(1)}'
   ```

### T014: 改善1c: 既定 design プリセットを汎用8基準へ置換

- **依存**: T004　**後続**: T005　**見積**: 2 ラウンド

**意図**

design.json を、T002 完了時点の17基準（ハーネス前提15 + numeric_roundtrip + defense_tradeoffs）から、汎用ソフトウェア設計用の8基準へ置き換える。ハーネス用の退避先は T004 で用意済みなので、このタスクの後戻りは design.json 1ファイルとテスト期待値の復元だけで済む。

**設計書の根拠 (design_refs)**

- `### 改善1: design プリセットの分割（スコープ適合）— 層B`
- `- `strict-goal/presets/design.json` を汎用ソフトウェア設計用に置き換え（下表の 8 基準）`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/presets/design.json` | 17基準から scope_adherence / numeric_roundtrip / internal_consistency / interface_completeness / failure_mode_mapping / defaults_decided / acceptance_tests / defense_tradeoffs の8基準へ置換（numeric_roundtrip と defense_tradeoffs は T001/T002 で追加済みのものを残す） |
| modify | `strict-goal/server/test/presets.test.js` | design の件数アサーションを17→8へ、auto比率を実値へ更新 |

**受け入れ条件**

- [ ] presets/design.json の criteria が設計書§改善1の表と同じ8つの id 集合と完全一致する
- [ ] design.json が validateRubric を通り、pass_score / pass_weighted_mean が 9 のままである
- [ ] rubric を保存済みの既存セッションの resume 挙動が変わらない（loop_open_resume.test.js が緑）
- [ ] design.harness.json は T004 の内容のまま17件で残っている

**検証コマンド**

1. プリセット差し替えが進行中セッションへ漏れないことの回帰（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/presets.test.js test/loop_open_create.test.js test/loop_open_resume.test.js
   ```

2. 8基準集合の完全一致と harness 側17件の保全を検査（期待終了コード 0）

   ```bash
   node -e 'try{const fs=require("fs");const d=JSON.parse(fs.readFileSync("strict-goal/presets/design.json","utf8"));const h=JSON.parse(fs.readFileSync("strict-goal/presets/design.harness.json","utf8"));const want=["scope_adherence","numeric_roundtrip","internal_consistency","interface_completeness","failure_mode_mapping","defaults_decided","acceptance_tests","defense_tradeoffs"].sort().join(",");process.exit(d.criteria.map(c=>c.id).sort().join(",")===want&&h.criteria.length===17?0:1)}catch(e){console.error("verify failed: "+e.message);process.exit(1)}'
   ```

### T005: 改善7a: criteria への priority フィールド追加と永続形への配線

- **依存**: T014　**後続**: T006　**見積**: 2 ラウンド

**意図**

rubric スキーマと tools.json の criteria に priority（integer, 既定0, 0〜3）を追加し、入力形から永続形へ変換する convertInputCriterion でも落ちないように通す。並び替えの実装は T006 で行う。

**設計書の根拠 (design_refs)**

- `### 改善7: `must_fix` の優先順位機構 — 層A`
- `- `strict-goal/server/src/rubric/schema.js:22-36` の criteria properties に `priority`（integer, 既定 0, 0〜3）を追加（`additionalProperties: false` なので明示追加が必須）`
- `- `strict-goal/server/schemas/tools.json` の `loop_open.input.rubric.criteria` に同様に追加`
- `- `strict-goal/server/src/rubric/from_input.js` の `convertInputCriterion` で `priority: criterion.priority ?? 0` を**明示的に埋める**`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/server/src/rubric/schema.js` | criteria properties に priority: { type: integer, minimum: 0, maximum: 3 } を追加 |
| modify | `strict-goal/server/schemas/tools.json` | loop_open.input.rubric.criteria と rubric_amend 側にも同様に追加 |
| modify | `strict-goal/server/src/rubric/from_input.js` | convertInputCriterion が priority を既定0で持ち越すようにする（未指定時も明示的に0を入れる） |
| modify | `strict-goal/server/test/rubric_schema.test.js` | priority の範囲外（-1 / 4 / 非整数）が E_VALIDATION になることを追加 |

**受け入れ条件**

- [ ] priority を持たない既存プリセットが validateRubric を通り、変換後の永続 rubric では priority が 0 になる
- [ ] priority が 4 または -1 の criteria は E_VALIDATION で拒否される
- [ ] presets/design.json に priority を書いた criteria が、セッションの rubric/<version>.json まで値を保って永続化される
- [ ] node --test test/rubric_schema.test.js test/loop_open_create.test.js が終了コード 0 で通る
- [ ] 旧セッションの永続 rubric に priority が無い場合でも、比較関数側の `?? 0` により NaN 由来の順序崩れが起きない

**検証コマンド**

1. スキーマ追加と amend 経路の回帰（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/rubric_schema.test.js test/loop_open_create.test.js test/rubric_amend.test.js
   ```

2. priority 未指定時に既定0が入ることを検査（期待終了コード 0）

   ```bash
   cd strict-goal/server && node -e 'import("./src/rubric/from_input.js").then(m=>{const c=m.convertInputCriterion({id:"x",statement:"0123456789012345",weight:1,anchors:{1:"a",5:"b",9:"c"},verification:"manual"});process.exit(c.priority===0?0:1)}).catch(e=>{console.error("verify failed: "+e.message);process.exit(1)})'
   ```

### T006: 改善7b: buildMustFix を priority 優先の並びに変更し design プリセットへ priority を割当

- **依存**: T005　**後続**: T007　**見積**: 2 ラウンド

**意図**

must_fix 3枠の割り当て順を priority 降順 → スコア昇順に変更し、scope_adherence=3 / numeric_roundtrip=3 / internal_consistency=2 を割り当てる。合否は最小値ゲートのままなので収束性には影響しない。

**設計書の根拠 (design_refs)**

- `- `score_submit.js:84`（関数定義は :81）のソート式を `sort((a, b) => (b.priority - a.priority) || (a.score - b.score))` に変更`
- `- `presets/design.json`: `scope_adherence`=3, `numeric_roundtrip`=3, `internal_consistency`=2、他は 0`
- `### 1.2 指摘1の処方が現行機構では効かない理由`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/server/src/tools/score_submit.js` | buildMustFix のソートキーを (b.priority - a.priority) || (a.score - b.score) に変更。priority は criteriaById から引く |
| modify | `strict-goal/presets/design.json` | 3基準へ priority を付与。他は 0 を明示 |
| modify | `strict-goal/server/test/score_submit.test.js` | priority 差のある2基準で、低優先・低得点より高優先・高得点が must_fix の先頭に来ることを検証 |

**受け入れ条件**

- [ ] priority 3 でスコア 8 の基準が、priority 0 でスコア 5 の基準より must_fix の先頭に来る
- [ ] 全基準の priority が既定0のとき、must_fix の順序が変更前と同一である（既存セッション互換）
- [ ] MUST_FIX_MAX=3 の打ち切りは維持され、must_fix は最大3件のままである
- [ ] 9点未満の基準が must_fix に載らなくても FINAL にならない（最小値ゲートが不変であること）

**検証コマンド**

1. 並び替えと合否ゲート不変の回帰（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/score_submit.test.js test/engine.test.js
   ```

2. score_submit は広範囲から呼ばれるため全体回帰で確認（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test
   ```

### T007: 改善4a: self_hosting のアンカー9を追記報酬から本文反映要求へ反転

- **依存**: T006　**後続**: T008　**見積**: 1 ラウンド

**意図**

『見つかった穴が番号つきで列挙されている』という現行アンカーが追記節を報酬していたため、『穴が該当節の本文に反映されており、レビュー記録・変更履歴・自己検証・補足の節が存在しない』へ反転する。監査経路は rounds/<round>.json と audit_export に既にあるため成果物本文に記録は要らない。

**設計書の根拠 (design_refs)**

- `### 改善4: 追記の報酬を外す + 追記節の警告 — 層B + 層A`
- `- `presets/design.harness.json` の `self_hosting.anchors`：アンカー9を「一巡で見つかった穴が**該当節の本文に反映されており**、レビュー記録・変更履歴・自己検証・補足の節が成果物に存在しない」に反転`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/presets/design.harness.json` | self_hosting.anchors.9 を反転。anchors.5 も追記節の存在を減点側に寄せる |
| modify | `strict-goal/server/test/presets.test.js` | 反転後のアンカー文言に『存在しない』が含まれることを固定 |

**受け入れ条件**

- [ ] design.harness.json の self_hosting.anchors.9 が『番号つきで列挙』を要求しなくなっている
- [ ] 同アンカーがレビュー記録・変更履歴・自己検証・補足の各節の不在を要求している
- [ ] design.harness.json が validateRubric を通り、anchors の 1 / 5 / 9 が揃っている

**検証コマンド**

1. アンカー文言の固定（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/presets.test.js
   ```

2. 反転の機械検査（期待終了コード 0）

   ```bash
   node -e 'try{const h=JSON.parse(require("fs").readFileSync("strict-goal/presets/design.harness.json","utf8"));const a=h.criteria.find(c=>c.id==="self_hosting").anchors["9"];process.exit(a.includes("存在しない")&&!a.includes("番号つき")?0:1)}catch(e){console.error("verify failed: "+e.message);process.exit(1)}'
   ```

### T008: 改善4b: 末尾追記節に appendix_accretion 警告を追加

- **依存**: T007　**後続**: T009　**見積**: 2 ラウンド

**意図**

見出しが補足|変更履歴|自己検証|レビュー記録|追記 に一致し、かつ文書の末尾20%に位置する節があれば警告する。位置条件は正当な付録の誤検知を減らすためにあり、拒否はしない。

**設計書の根拠 (design_refs)**

- `- `artifact_commit.js`：見出しが `補足|変更履歴|自己検証|レビュー記録|追記` に一致し、かつ文書の末尾 20% に位置する場合 `warnings.push('appendix_accretion')``
- `**決定**: **警告のみ**。拒否しない。`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/server/src/config/defaults.js` | APPENDIX_ACCRETION_PATTERN と APPENDIX_TAIL_RATIO=0.2 を定数として追加 |
| modify | `strict-goal/server/src/tools/artifact_commit.js` | markdown/text 経路の warnings 生成部へ検査を追加。拒否経路には一切触らない |
| modify | `strict-goal/server/test/artifact_commit.test.js` | 末尾20%の追記見出しで警告が出ること、先頭側の同名見出しでは出ないこと |
| add | `strict-goal/server/src/artifact/heading_scan.js` | T008 で新設し T009 で共用する。4スペースインデントのコードブロックは追わない（設計書の限界記述どおり） |

**受け入れ条件**

- [ ] 末尾20%に『## 21. 設計自己検証の記録』を持つ本文の commit で warnings に appendix_accretion が含まれる
- [ ] 同じ見出しが文書前半にある場合は appendix_accretion が出ない
- [ ] appendix_accretion が出ても commit は成功し、state と round が通常どおり進む
- [ ] fileset 経路（artifact_kind:fileset）では本検査が動かない
- [ ] コードフェンス内の `## 変更履歴` のようなサンプル行では appendix_accretion が出ない

**検証コマンド**

1. 警告追加が拒否経路を壊していないこと（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/artifact_commit.test.js test/errors_artifact_commit.test.js
   ```

2. fileset 経路への波及がないこと（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/fileset.test.js
   ```

### T009: 改善2: policy.scope_guard_terms と out_of_scope_section 警告

- **依存**: T008　**後続**: T010　**見積**: 2 ラウンド

**意図**

policy に scope_guard_terms（string[]、既定[]）を追加し、Markdown 見出し行に当該語を含む節があれば警告する。既定が空配列なので既存セッションの挙動は変わらない。語彙ベースで誤検知するため拒否はしない。

**設計書の根拠 (design_refs)**

- `### 改善2: スコープ外節の警告 — 層A`
- `**差分方針**: `policy.scope_guard_terms`（`string[]`、既定 `[]`）を追加。Markdown 見出し行に当該語を含む節があれば `warnings.push('out_of_scope_section')`。既定が空配列なので**既存セッションの挙動は変わらない**。`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/server/src/rubric/schema.js` | policy へ scope_guard_terms（array of string, 既定省略可）を追加 |
| modify | `strict-goal/server/schemas/tools.json` | loop_open.input.rubric.policy にも同キーを追加（additionalProperties:false のため） |
| modify | `strict-goal/server/src/tools/artifact_commit.js` | 見出し行に対する語彙検査を warnings 生成部へ追加 |
| modify | `strict-goal/server/test/artifact_commit.test.js` | 語指定時に出ること・既定[]で出ないこと・policy 未知キーが E_VALIDATION になること |
| modify | `strict-goal/server/src/artifact/heading_scan.js` | T008 で新設した共通関数を out_of_scope_section からも呼ぶ（検査ロジックを1箇所に集約） |

**受け入れ条件**

- [ ] scope_guard_terms:["配布","CI"] のセッションで、該当語を含む見出しを持つ本文の commit が out_of_scope_section を警告する
- [ ] scope_guard_terms 未設定または [] のセッションでは同警告が一切出ない
- [ ] policy に未知キーを与えると schema.js の additionalProperties:false により E_VALIDATION になる
- [ ] out_of_scope_section は警告のみで、commit の成否に影響しない
- [ ] コードフェンス内の `## 配布パッケージ` のような行は見出しとみなされず out_of_scope_section を誘発しない

**検証コマンド**

1. 警告と policy スキーマの回帰（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/artifact_commit.test.js test/rubric_schema.test.js
   ```

2. 既定値表との整合（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/defaults.test.js test/defaults_table.test.js
   ```

### T010: 改善6: policy.artifact_budget_bytes と over_budget 警告

- **依存**: T009　**後続**: T011　**見積**: 2 ラウンド

**意図**

分量予算を policy の任意キーとして追加し、超過時に警告する。design の初期値28,000Bは§1.3の実測（vanilla最大22,933Bの1.22倍）に基づく。硬い上限にすると suspicious_shrink との往復振動で max_rounds を食い潰すため、警告に留める。

**設計書の根拠 (design_refs)**

- `### 改善6: 分量予算 — 層A（警告）+ 層B`
- `**変更対象**: `rubric/schema.js` の `policy` に `artifact_budget_bytes`（integer, 任意）、`artifact_commit.js` に `warnings.push('over_budget')`。`
- `### 1.3 指摘5の原因帰属が誤りである理由`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/server/src/rubric/schema.js` | policy へ artifact_budget_bytes（integer, minimum 1, 任意）を追加 |
| modify | `strict-goal/server/schemas/tools.json` | loop_open.input.rubric.policy にも同キーを追加 |
| modify | `strict-goal/server/src/tools/artifact_commit.js` | bytes > artifact_budget_bytes のとき over_budget を push。未設定なら検査しない |
| modify | `strict-goal/presets/design.json` | policy.artifact_budget_bytes = 28000 を設定 |
| modify | `strict-goal/server/test/artifact_commit.test.js` | 28,000B 超で出ること・未設定で出ないこと |

**受け入れ条件**

- [ ] artifact_budget_bytes:28000 のセッションで 28,000B を超える本文を commit すると over_budget が警告される
- [ ] artifact_budget_bytes が未設定のセッションでは over_budget が一切出ない
- [ ] over_budget は拒否に昇格しておらず、commit は成功する
- [ ] presets/design.json の policy.artifact_budget_bytes が 28000 であり、design.harness / plan / implement には未設定である

**検証コマンド**

1. 警告とプリセット値の回帰（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/artifact_commit.test.js test/presets.test.js
   ```

2. design のみ 28000 で、design.harness / plan / implement は未設定であることを4プリセットまとめて検査（期待終了コード 0）

   ```bash
   node -e 'try{const fs=require("fs");const g=n=>JSON.parse(fs.readFileSync("strict-goal/presets/"+n+".json","utf8")).policy.artifact_budget_bytes;const ok=g("design")===28000&&g("design.harness")===undefined&&g("plan")===undefined&&g("implement")===undefined;if(!ok)console.error("verify failed: budgets="+[g("design"),g("design.harness"),g("plan"),g("implement")].join("/"));process.exit(ok?0:1)}catch(e){console.error("verify failed: "+e.message);process.exit(1)}'
   ```

### T011: §5: 効果測定スクリプトの整備

- **依存**: T010　**後続**: T013　**見積**: 2 ラウンド

**意図**

設計書§5の5指標（数式バグ数・規範の矛盾数・範囲外の節数・文書バイト数・ラウンド数）を .benchmark 配下の成果物と session.json から機械計数するスクリプトを追加する。ベンチマークの再実行そのものは人間が起動する。

**設計書の根拠 (design_refs)**

- `## 5. 効果の測り方`
- `| ラウンド数 | `session.json` の `round`（改善7 の副作用の監視） |`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| add | `scripts/measure-rubric-effect.sh` | 5群の成果物バイト数・見出し数・範囲外見出し数・session.json の round を TSV で出力 |
| add | `strict-goal/server/test/measure_script.test.js` | --dry-run で終了コード0、ヘッダ行の列数が5であることを検証 |

**受け入れ条件**

- [ ] bash scripts/measure-rubric-effect.sh --dry-run が終了コード 0 で、5指標のヘッダ行を出力する
- [ ] .benchmark が存在しない環境でも --dry-run が異常終了しない
- [ ] scripts/measure-rubric-effect.sh に scope_guard_terms を引数で渡すと、範囲外見出し数の列が0以上の整数として出力される
- [ ] 計数結果が群（vanilla / default_goal / strict_hierarchical / strict_single / prompt_rubric）ごとに分かれて出る
- [ ] scripts/measure-rubric-effect.sh と test/measure_script.test.js の2ファイルを削除するだけで T010 完了地点へ戻せる（サーバ本体から import されず、他タスクの検証コマンドからも参照されない）

**検証コマンド**

1. .benchmark 非依存で起動できること（期待終了コード 0）

   ```bash
   bash scripts/measure-rubric-effect.sh --dry-run
   ```

2. 出力形式の固定（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/measure_script.test.js
   ```

### T012: 層C: SKILL.md のモード選択表へプリセット選択の1行を追加

- **依存**: T004　**後続**: T013　**見積**: 1 ラウンド

**意図**

既定 design が汎用へ変わるため、ハーネス／プロトコル設計では design.harness を明示指定すべき旨をモード選択表に1行足す。層Cなので破られうると設計書が認めた限界をそのまま受け入れる。

**設計書の根拠 (design_refs)**

- `層 C（`SKILL.md` のモード選択表に1行）でしか防げない`
- `## 2. 設計原則 — 拘束力の3層`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| modify | `strict-goal/skills/strict-goal/SKILL.md` | モード選択表に design.harness の行を1行追加。FINAL の記述規約と絶対パス禁止に触れない範囲で書く |
| modify | `strict-goal/server/test/skill_md.test.js` | 追加行が7見出し検査・FINAL 検査・絶対パス検査を壊さないこと |

**受け入れ条件**

- [ ] SKILL.md のモード選択表に design.harness を指定すべき条件が1行で書かれている
- [ ] skill_md.test.js の7見出し検査・FINAL 宣言禁止検査・絶対パス/資格情報検査がすべて緑である
- [ ] subagents.test.js のエージェント定義アサーションが壊れていない

**検証コマンド**

1. スキル文書の既存アサーションを維持（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test test/skill_md.test.js test/subagents.test.js
   ```

2. 追記が入ったことの確認（1件以上で終了コード0）（期待終了コード 0）

   ```bash
   grep -c 'design.harness' strict-goal/skills/strict-goal/SKILL.md
   ```

### T013: 全体回帰と未決事項の明文化

- **依存**: T011, T012　**後続**: なし（終端）　**見積**: 2 ラウンド

**意図**

設計書§4の変更一覧7件が実装済みであることを突き合わせ、全テストを通す。対応表と未決事項は上流設計書ではなく新規の実装記録ファイルへ書く（上流 design 成果物を改変すると plan セッションのピン digest が drift するため）。加えて CLAUDE.md のハマりポイントへ今回得た知見を追記する。

**設計書の根拠 (design_refs)**

- `# スコープ遵守と計算検証の強制 — ルーブリック改善設計`
- `## 4. 変更一覧`
- `**全体の回帰確認**: `cd strict-goal/server && node --test``
- `## 範囲外・未決事項`
- `### 改善どうし・既存検査との相互作用`

**変更対象**

| kind | path | 備考 |
|---|---|---|
| add | `docs/plans/impl-record-rubric-scope-and-verification.md` | 実装記録。設計書§4の7改善ごとに実装ファイルとテストの対応表を書き、『範囲外・未決事項』の9項目を「- 未実装: …」の形で1行ずつ転記する。上流設計書そのものは書き換えない |
| modify | `CLAUDE.md` | ハマりポイントへ本実装で実際に踏んだ2点（priority が from_input.js を通さないと落ちる件、プリセット基準数と presets.test.js の連動）のみを追記する。リポジトリの知見記録ルールに基づく運用作業であり、設計書のスコープは広げない |
| modify | `scripts/verify-critique-claims.sh` | C2 / C6 / C7 / C9 を改訂前の主張として注記し、実装後の値へ期待値を再ベースラインする |

**受け入れ条件**

- [ ] cd strict-goal/server && node --test が終了コード 0 で全件通る。Windows で rename 競合の EPERM が出た場合は同一コマンドを1回だけ再実行し、その2回目も終了コード 0 でなければ不合格とする（再実行は1回まで、判断の余地を残さない）
- [ ] 実装記録ファイルに、設計書§4の7改善それぞれの実装ファイルと該当テストが1対1の対応表として書かれている
- [ ] 実装記録ファイルに設計書『範囲外・未決事項』の9項目が「- 未実装: 」で始まる9行として転記されており、実装したと誤解させる記述がない
- [ ] scripts/verify-critique-claims.sh の C2 / C6 / C7 / C9 が実装後の値へ再ベースラインされ、各検査に改訂前の主張であることの注記が入っている
- [ ] 再ベースライン後に bash scripts/verify-critique-claims.sh が終了コード 0 で全件 OK を出す
- [ ] node scripts/check-plan-coverage.mjs と node scripts/check-plan-verify-order.mjs が、実装記録ファイルの追加後も終了コード 0 で通る
- [ ] 上流設計書 docs/plans/design-rubric-scope-and-verification.md の sha256 が、plan セッションがピンした f0341784676b40db38f0fc928bd957185f76e959f43fc6fd00be7fd6608e2b1f のまま変化していない（本計画は上流 FINAL 成果物を1バイトも書き換えない）

**検証コマンド**

1. 全体回帰。EPERM フレーク時の再実行は1回まで、2回目の失敗は不合格（期待終了コード 0）

   ```bash
   cd strict-goal/server && node --test
   ```

2. 設計書の事実主張が実装後も成立すること（期待終了コード 0）

   ```bash
   bash scripts/verify-critique-claims.sh
   ```

3. 実装記録ファイルを追加した後も見出し・ファイル網羅と design_refs の整合が保たれること（期待終了コード 0）

   ```bash
   node scripts/check-plan-coverage.mjs
   ```

4. 全タスクの検証コマンドが中間状態で解決可能なままであること（期待終了コード 0）

   ```bash
   node scripts/check-plan-verify-order.mjs
   ```

5. 上流 design 成果物が未改変（ピン digest と一致）であることの機械検証。drift すると plan セッションが SUPERSEDED 化する（期待終了コード 0）

   ```bash
   node -e 'try{const c=require("crypto"),fs=require("fs");const h=c.createHash("sha256").update(fs.readFileSync("docs/plans/design-rubric-scope-and-verification.md")).digest("hex");if(h!=="f0341784676b40db38f0fc928bd957185f76e959f43fc6fd00be7fd6608e2b1f")console.error("verify failed: upstream drifted to "+h);process.exit(h==="f0341784676b40db38f0fc928bd957185f76e959f43fc6fd00be7fd6608e2b1f"?0:1)}catch(e){console.error("verify failed: "+e.message);process.exit(1)}'
   ```

6. 範囲外・未決事項9項目が未実装として転記されていることの計数検証（期待終了コード 0）

   ```bash
   [ "$(grep -c '^- 未実装: ' docs/plans/impl-record-rubric-scope-and-verification.md)" = "9" ]
   ```

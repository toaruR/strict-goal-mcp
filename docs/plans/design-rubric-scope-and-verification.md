# スコープ遵守と計算検証の強制 — ルーブリック改善設計

対象: `strict-goal`（rubric-loop-mcp）のルーブリックプリセットと `score_submit` / `artifact_commit` の検査。
再現検証: `bash scripts/verify-critique-claims.sh`（C1〜C16、全件 OK / 終了コード 0）。本書の事実主張はすべて同スクリプトの検査番号で参照する。

---

## 1. 判定サマリ

| # | 指摘 | 判定 | 決め手 |
|---|---|---|---|
| 1 | 優先順位の階層を組み替える | **部分的に妥当**（症状は正、原因診断が浅く、処方は現行機構では無効） | 判定式は全基準の同格ゲート（C5）。散文の順位は判定にも `must_fix` 選抜にも入らない（C6） |
| 2 | 列挙する検証 → 計算する検証 | **妥当**。5件中もっとも費用対効果が高い | design プリセットに数値検算を求める基準が 0 件。一方 `verification:"auto"` の強制枠は既存（C9） |
| 3 | 追記型の修正を禁止し本文を書き直させる | **妥当**。さらに現行ルーブリックが追記を*報酬している* | `self_hosting` のアンカー9が「穴の番号つき列挙」を要求 → §17/§21 は基準への最適解 |
| 4 | 防御策にトレードオフ記述を義務づける | **妥当**（優先度は中） | `anti_gaming` は防御を足すほど加点し副作用は減点しない非対称。`rejected_alternatives` は weight 1 かつ「採らなかった案」であり「採った防御の副作用」を覆わない |
| 5 | 分量の予算と範囲外の逃がし先 | **主張は妥当、原因帰属は誤り** | 肥大化の最大群は `prompt_rubric`（中央値 32,997B）。`strict_hierarchical` は 21,256B で5群中3番目に小さい（C8, C11） |

### 1.1 指摘1が「原因診断が浅い」と判定した理由

指摘は原因を「網羅しろという上位の圧力が強すぎ、止める力が弱かった」と置く。実測はもっと単純で、もっと深い。

被指摘成果物のセッション（`.benchmark/sandboxes/tr_0Q7S7P9CX2CDHW8Y51YEM6VXKF/.strict-goal/sessions/rl_01M2PYVBQ16E132X7BSAPF0ACX/`）を開くと：

- 課題は「単一 Node.js プロセスの Sliding Window Counter 方式 Rate Limiter **クラス**の設計仕様書」（C3）
- 適用されたルーブリックは `strict-goal/presets/design.json` と**基準 id 15件が完全一致**（C2）

この 15 件は*エージェントハーネスの設計*用の基準である。`packaging_conformance`（アンカー9＝「マニフェストが実物として載っており、スキーマ検査スクリプトが終了コード0で通る」）、`self_hosting`、`host_portability`、`auditability`、`verdict_ownership`、`anti_gaming`、`state_externalized` は、Rate Limiter クラスの設計には存在しない対象を要求する。

そして合否は全基準 9 点以上（C5）。つまり **§13「配布パッケージとホスト互換性」も §17「自己適用レビュー記録」も、圧力に負けて書かれたのではなく、合格するために書くしかなかった**。スコープ外の節は逸脱ではなくルーブリックへの正解である。

対応表（すべて C4 で見出しの存在を機械検査済み）：

| 成果物の節 | 対応する基準 | その基準のアンカー9が要求するもの |
|---|---|---|
| §13 配布パッケージとホスト互換性 | `packaging_conformance` / `host_portability` | 実物のマニフェストと終了コード0の検査スクリプト |
| §16 検証、合否、監査 | `auditability` / `verdict_ownership` | 受理・拒否・根拠・digest・時刻が残る出力形式 |
| §17 自己適用レビュー記録 | `self_hosting` | 一巡の追跡と「見つかった穴の番号つき列挙」 |
| §18 代替案の比較 | `rejected_alternatives` | 各代替案がどの要件を満たせないか |
| §20 整合性補足 / §21 設計自己検証の記録 | `self_hosting`（再掲）＋ 追記で穴を塞ぐ最短経路 | — |

### 1.2 指摘1の処方が現行機構では効かない理由

指摘は「階層の上位に順に制約を置く」という散文の優先順位表を処方する。本ハーネスでは以下の2点により、これは判定に一切影響しない。

- `strict-goal/server/src/judge/engine.js:25` — `passed = minScoreValue >= policy.pass_score && weightedMeanValue >= policy.pass_weighted_mean`。最小値ゲートなので、weight 1 の `rejected_alternatives` も weight 3 の `accuracy` も**等しく 9 点必須のハードゲート**。「上位／下位」という概念が判定式に存在しない（C5）。
- `strict-goal/server/src/tools/score_submit.js:84`（関数 `buildMustFix` の定義は同ファイル :81） — `sort((a, b) => a.score - b.score)` で**スコア昇順のみ**、`MUST_FIX_MAX = 3`（`config/defaults.js:18`）で打ち切り（C6）。スコープ違反を 7 点にしても、網羅系の 5 点・6 点・6 点に押し出されてモデルに通知されない。

したがって指摘1は、**優先順位を機構化する（改善7）**か、**そもそも当たらない基準を外す（改善1）**かのどちらかに翻訳しない限り、文言を足すだけでは空振りする。

### 1.3 指摘5の原因帰属が誤りである理由

全ベンチマーク run の成果物サイズ（1,000B 未満のスタブを除く、バイト数。中央値は C11 で機械照合）：

| 群 | n | 中央値 | 最小 | 最大 |
|---|---|---|---|---|
| vanilla | 7 | 18,531 | 11,226 | 22,933 |
| default_goal | 7 | 20,670 | 12,820 | 37,510 |
| **strict_hierarchical** | 13 | **21,256** | 14,587 | 33,627 |
| strict_single | 4 | 25,147 | 15,023 | 37,740 |
| prompt_rubric | 7 | 32,997 | 13,737 | 38,271 |

`strict_hierarchical` は 5 群中 3 番目に小さく、最大の `prompt_rubric` の 64% しかない。肥大化は `strict_hierarchical` 固有ではなく**ルーブリック駆動全般の性質**であり、むしろ `prompt_rubric` のほうが強い。よって分量予算は `strict_hierarchical` の是正策ではなく、全プリセット共通の機構として置くべきである。ここを取り違えると、階層委譲の側だけを絞って効果が出ない。

---

## 2. 設計原則 — 拘束力の3層

改善案は「モデルがそれを無視できるか」で 3 層に分ける。**規範は必ず上の層から割り当てる。散文は最後**。

| 層 | 実体 | 拘束力 | 破られ方 |
|---|---|---|---|
| **A. サーバ側チェック** | `score_submit` / `artifact_commit` の `fail()` と `warnings` | 最強（拒否は絶対、警告は記録に残る） | 検査の穴を突く |
| **B. ルーブリック基準とアンカー** | `presets/*.json`、`policy` | 中（点数に直結するのでモデルが最適化する） | 文言だけ満たす |
| **C. スキル文言** | `SKILL.md`、`sg-verifier` プロンプト | 最弱 | 単に守られない |

§1.1 が示した失敗は、層 B（間違ったプリセット）が層 C（「スコープを守れ」）を圧倒した結果である。同じ構図を作らないため、以下の各改善は必ず層 A か B に着地させる。

---

## 3. 改善案

各案は「変更対象 → 差分方針 → 副作用と回避手口 → 拒否／警告／記録の決定 → 検証」の順に書く。

### 改善1: design プリセットの分割（スコープ適合）— 層B

**変更対象**
- 新規 `strict-goal/presets/design.harness.json` ← 現行 `design.json` の 15 基準をそのまま移設
- `strict-goal/presets/design.json` を汎用ソフトウェア設計用に置き換え（下表の 8 基準）
- `strict-goal/server/src/rubric/presets.js` — `VALID_MODES`（3値）をプリセット名集合に一般化し、`loadPreset` の `presets/${mode}.json` 解決をプリセット名で行う
- `strict-goal/server/schemas/tools.json:26` — `rubric_preset` の enum に `design.harness` を追加

**新 `design.json` の基準**

| id | weight | verification | 趣旨 |
|---|---|---|---|
| `scope_adherence` | 3 | auto | 課題に無い成果物種別（配布物・CI・運用手順）の節が 0 件。範囲外事項は末尾の1行リストに退避 |
| `numeric_roundtrip` | 3 | auto | 改善3 |
| `internal_consistency` | 3 | auto | 各規範（値・閾値・合格条件）が文書中1箇所でのみ定義され、未定義の変数を本文が使っていない |
| `interface_completeness` | 3 | auto | 現行から流用 |
| `failure_mode_mapping` | 2 | manual | 現行から流用 |
| `defaults_decided` | 2 | auto | 現行から流用 |
| `acceptance_tests` | 2 | manual | 現行から流用 |
| `defense_tradeoffs` | 2 | manual | 改善5 |

**副作用と回避手口**
- 既定の `design` が汎用に変わるため、ハーネス／プロトコル設計で `design.harness` の指定を忘れると網羅性が落ちる。→ 層 C（`SKILL.md` のモード選択表に1行）でしか防げない。**これは限界として受け入れる**（誤って厳しすぎるより、誤って緩いほうが差し戻しで回復できる）。
- 実行中セッションへの影響は無い。ルーブリックは `sessions/<id>/rubric/<version>.json` に実体保存されており（C2 はこのファイルとプリセットの比較）、`loop_open_resume.js:96` は `loadRubric(sDir, session.rubric_version)` を呼ぶだけで `loadPreset` を一度も呼ばない（C14）。加えて `resume` に `rubric` を渡すと `E_RUBRIC_ON_RESUME` で拒否される（同 :75）ので、プリセット差し替えが進行中セッションに漏れる経路が無い。

**決定**: 拒否も警告もしない（プリセット選択の誤りは検出不能）。記録は `session.json` の `rubric_digest` に既に残る。

**検証**: `node -e` で両プリセットが `validateRubric` を通ること、`rubric_preset:"design.harness"` の `loop_open` が現行 15 基準を返すこと。

### 改善2: スコープ外節の警告 — 層A

**変更対象**: `strict-goal/server/src/tools/artifact_commit.js`（`warnings.push` 群、現行 142〜179 行付近）、`rubric/schema.js` の `policy`

**差分方針**: `policy.scope_guard_terms`（`string[]`、既定 `[]`）を追加。Markdown 見出し行に当該語を含む節があれば `warnings.push('out_of_scope_section')`。既定が空配列なので**既存セッションの挙動は変わらない**。

**副作用と回避手口**
- 語彙ベースの検査は誤検知する（CI 設計そのものが課題のとき「CI」は正当）。→ だから**拒否しない**。
- **コードフェンス内の行を見出しと誤認する**。Markdown の ```` ``` ```` ブロックに `## 配布パッケージ` のような行や対象語を含むサンプルを貼ると、行単位の正規表現は見出しとして拾う。→ 検査前に ```` ``` ```` / ```` ~~~ ```` の開閉を数えてフェンス内行を除外する前処理を入れる。ただし**4スペースインデントのコードブロックは追わない**（引用ブロック内の見出しと区別できないため）。ここは限界として残す。同じ前処理を改善4の `appendix_accretion` にも共用する。
- 見出しを曖昧にして本文にスコープ外を書けば素通りする。→ 検知不能。層 B の `scope_adherence`（採点者が本文を読む）と二重化して初めて意味を持つ。単独では機能しない機構である。

**決定**: **警告のみ**。拒否しない。`rounds/<round>.commit.json` に残り `audit_export` に出る。

**検証**: `scope_guard_terms:["配布","CI"]` で被指摘成果物本文を投げ、`out_of_scope_section` が出ること／空配列で出ないこと。

### 改善3: `numeric_roundtrip` 基準 — 層B（新規コード不要）

指摘2の核。**既存機構だけで実装できるのが最大の利点**。

**変更対象**: `presets/design.json` の criteria 追加のみ。

```
id: numeric_roundtrip / weight: 3 / verification: "auto"
statement: 本文の各数式・判定規則が、境界を含む具体値で検算され、
           出力値を入力に戻す往復チェックが最低1本実行されている
anchors.9: 各数式について境界を含む2ケース以上の代入結果が §テスト の期待値と
           一致することが示され、かつ「返した待機時間だけ時刻を進めたら許可されるか」
           型の往復チェックが1本以上、終了コード0の実行ログで示されている
```

`policy.require_command_evidence_for: ["auto"]` は design / plan / implement の 3 プリセットすべてに既存（C12。現行 design にも auto 基準が 3 件ある＝C9）。強制は `strict-goal/server/src/evidence/verify.js:22` の `fail('E_EVIDENCE_KIND', 'verification:"auto" criteria require at least one command evidence')` が行う（C13）。したがって **`kind:"command"` の根拠を 1 件も付けない提出は自動的に拒否される**。サーバ改修は不要。

**副作用と回避手口**
- `echo ok` で `exit_code: 0` を作れば形式上は通る。根拠コマンドの中身までは検証できない。
- 緩和: `sg-verifier` プロンプト（層C）に「往復チェックの入力値と出力値の両方が `output_excerpt` に現れない場合は 8 点以下」を追加する。層 C なので破られうる。
- 検算コマンドを書く手間で 1〜2 ラウンド増える。`max_rounds: 12` の範囲内。

**決定**: command 根拠の**存在**は拒否（既存 `E_EVIDENCE_KIND`）、**中身**は採点者の減点に委ねる。中身の機械検証は不能と明記する。

**検証**: `verification:"auto"` の基準に locator 根拠のみを付けた `score_submit` が `E_EVIDENCE_KIND` で落ちること。この経路は既存の `test/evidence.test.js` / `errors_score_submit.test.js` / `at_3.test.js` / `failure_modes_1_10.test.js` が既に覆っており、新規テストは基準追加の妥当性（プリセットが `validateRubric` を通ること）だけでよい。

### 改善4: 追記の報酬を外す + 追記節の警告 — 層B + 層A

指摘3は妥当だが、**禁止する前に報酬を外さないと効かない**。現行 `self_hosting` のアンカー9は「見つかった穴が番号つきで列挙され、各穴の反映先が示されている」であり、§17/§21 はこの基準への最適解だった。

**変更対象**
- `presets/design.harness.json` の `self_hosting.anchors`：アンカー9を「一巡で見つかった穴が**該当節の本文に反映されており**、レビュー記録・変更履歴・自己検証・補足の節が成果物に存在しない」に反転
- `artifact_commit.js`：見出しが `補足|変更履歴|自己検証|レビュー記録|追記` に一致し、かつ文書の末尾 20% に位置する場合 `warnings.push('appendix_accretion')`

反転が正当化できる根拠は、**監査経路が成果物の外に既にある**こと。各ラウンドの提出・拒否・根拠・digest・時刻は `rounds/<round>.json` と `rounds/<round>.commit.json` に永続化され、`audit_export` で取り出せる。成果物本文に検証記録を残す必要は無い。

**副作用と回避手口**
- 見出しを「§20 整合性の確認」に変えれば正規表現を回避できる。→ 警告止まりなので実害は小さいが、**検知率は低い**と明記する。
- コードフェンス内の `## 変更履歴` のようなサンプル行を見出しと誤認する。→ 改善2 と同じフェンス除外前処理を共用する（実装も1関数に集約する）。4スペースインデントのコードブロックを追わない限界も同じ。
- 末尾 20% という位置条件を外すと、正当な「付録: 用語集」も拾う。位置条件は誤検知を減らすためにある。
- 本文書き直しを強制すると `artifact_commit` の `changed_ratio >= 0.9` が発火し `near_total_rewrite` 警告が毎周出る。これは**正常**であり、`destructive_overwrite` とは別物なので拒否には至らない。後者の実条件は `artifact_commit.js:171-176` の 3 連言 — `changed_ratio >= 0.9` かつ **今回が 200B 未満** かつ **前周が 2,000B 以上**（`DESTRUCTIVE_OVERWRITE_MIN_BYTES = 200`、`_PREVIOUS_MULTIPLE = 10`、C15）。本文を書き直した設計書が 200B を切ることは無い。警告は 4 種のみで、いずれも拒否しない（C7）。

**決定**: **警告のみ**。拒否しない。

**検証**: 被指摘成果物本文で `appendix_accretion` が出ること、§18 までの版で出ないこと。

### 改善5: `defense_tradeoffs` 基準 — 層B

**変更対象**: `presets/design.json` および `presets/design.harness.json` に追加（weight 2, manual）。

```
statement: 堅牢化のために追加した各機構について、それが失敗させる正当ケースと
           代替案が1〜2文で併記されている
anchors.9: 追加された全機構に、失敗させる正当ケース・代替案・
           「拒否／警告／記録のどれにするか」の決定が書かれている。
           防げないものは限界として明記されている
```

これは `anti_gaming`（防御を足すほど加点される）の**非対称を打ち消す対**として置く。指摘4の `maxKeys` 満杯時 `RangeError` は、この基準があれば「正規の新規ユーザーを締め出す」が weakness として書かれる。

**副作用と回避手口**
- 機構を足さない設計では空節になる。→ アンカーを「追加された全機構に」と条件付きにしてあるので、追加0件なら自動的に満点側。
- 「副作用は無い」と1文書けば形式上は満たせる。→ 層 A では検出できない。`sg-verifier` が weakness で突くしかない。
- `anti_gaming` と同時に置くと、モデルは「防御を足して副作用も書く」で両取りできてしまい、*足さない*方向へのインセンティブは生まれない。抑止力があるのは指摘4の想定より弱い、と見積もる。

**決定**: 拒否も警告もしない（層 B のみ）。

**検証**: 改訂後の両プリセットが `validateRubric` を通ること。効果の確認は §5 の再測定に委ねる。

### 改善6: 分量予算 — 層A（警告）+ 層B

**変更対象**: `rubric/schema.js` の `policy` に `artifact_budget_bytes`（integer, 任意）、`artifact_commit.js` に `warnings.push('over_budget')`。

**初期値**: design で **28,000 B**。根拠は §1.3 の実測値からの検算で、倍率ではなく次の2式で決めた（いずれも C11 で機械照合済みの実測値を入力とする）。

```
28000 ÷ 22933 = 1.22094…  → vanilla の実測最大（要求を満たした最長の成果物）に対して 22.1% の余裕
28000 ÷ 21256 = 1.31727…  → strict_hierarchical の中央値に対して 31.7% の余裕
```

境界の往復チェック: 22,933B の成果物は 28,000 未満なので鳴らない。`prompt_rubric` の中央値 32,997B は 28,000 を超えるので鳴る。すなわちこの閾値は「vanilla で要求を満たせた最長」と「最も肥大した群の中央値」の間に落ちており、実測 5 群のうち鳴るのは `prompt_rubric` 側だけである。中央値ではなく最大側を基準に採るのは、予算超過を「例外的に長い」ときだけ鳴らしたいため。

**副作用と回避手口**
- **硬い上限にしてはならない**。拒否にすると、モデルは削るために `suspicious_shrink`（前周の 50% 未満）を踏み、次周で戻して振動する。往復で `max_rounds` を食い潰す。よって警告のみ。
- 正当に長い設計（本書のような多面的な設計）で常時鳴る。→ 警告なので無視できる。ただし「鳴りっぱなしで誰も見ない警告」になる劣化は避けられない。これは限界。

**決定**: **警告のみ**。既定は未設定（`undefined` なら検査しない）＝既存セッション無影響。

**検証**: 28,000B 超の本文で `over_budget` が出ること、`artifact_budget_bytes` 未設定で出ないこと、`policy` に未知キーを与えたとき `rubric/schema.js` の `additionalProperties: false` が `E_VALIDATION` を返すこと。

### 改善7: `must_fix` の優先順位機構 — 層A

指摘1を**唯一機能する形に翻訳した案**。

**変更対象**
- `strict-goal/server/src/rubric/schema.js:22-36` の criteria properties に `priority`（integer, 既定 0, 0〜3）を追加（`additionalProperties: false` なので明示追加が必須）
- `strict-goal/server/schemas/tools.json` の `loop_open.input.rubric.criteria` に同様に追加
- `score_submit.js:84`（関数定義は :81）のソート式を `sort((a, b) => (b.priority - a.priority) || (a.score - b.score))` に変更
- `strict-goal/server/src/rubric/from_input.js` の `convertInputCriterion` で `priority: criterion.priority ?? 0` を**明示的に埋める**。入力形（statement ベース）から永続形への変換は未知フィールドを落とすため、ここを通さないとプリセットに書いた `priority` が永続 rubric に届かない
- `presets/design.json`: `scope_adherence`=3, `numeric_roundtrip`=3, `internal_consistency`=2、他は 0

これにより「正確性 > 一貫性 > スコープ > 堅牢性 > 網羅性」が、**散文ではなく `must_fix` 3枠の割り当て順**として実体化する。

**副作用と回避手口**
- priority 付き基準が 3 枠を占め、低得点の網羅系基準がモデルに通知されない。→ `must_fix` は**通知であって合否ではない**（合否は `engine.js:25` の最小値ゲート、C5）。通知されない基準も 9 点未満なら FINAL にならないので、収束性は壊れない。
- ただし通知されない基準の修正が後回しになり、ラウンド数は増える。`max_rounds`（design 12）と `stall_window`（3）で打ち切られる。**ラウンド数増加は測定対象に入れる**（§5）。
- `priority` を既定 0 にするため、既存プリセット・既存セッションの `must_fix` 順序は変わらない。ただし**この「変わらない」を JavaScript の暗黙仕様に依存させてはならない**。`priority` が `undefined` のままだと `b.priority - a.priority` は `NaN` になり、`NaN || (a.score - b.score)` が falsy 短絡で偶然スコア昇順に落ちるだけである。保守時に `(b.priority ?? 0) - (a.priority ?? 0)` へ「安全に」書き換えると 0 === 0 でもやはり短絡するので結果は同じだが、`Number(b.priority) - Number(a.priority)` のような別の書き換えでは `NaN` が 0 に潰れず順序が壊れうる。よって**既定 0 は `from_input.js` の変換時点で実体として埋め**、比較式が値の存在を前提にできる状態にする（上記の変更対象に追加済み）。永続 rubric に `priority` が無い旧セッションを読む経路のためだけに、比較関数側でも `?? 0` を残す二重化を行う。
- `rubric_amend` で `priority` を自分で下げ、スコープ違反を `must_fix` の通知から外す回避が成立する。→ **priority 引き下げを緩和（relaxation）分類に含めれば拒否できる**。`rubric_amend.js:60` は緩和分類の変更を `acknowledge_relaxation: true` 無しでは `E_RELAXATION_UNACKNOWLEDGED` で拒否し、差分は `rubric_diff/<version>.json` に永続化される（C16）。自覚的な引き下げは通るが、必ず `reason`（40文字以上）とともに監査に残る。

**決定**: 拒否しない。`must_fix` の並び順のみ変更。`priority` 引き下げは `rubric_amend` の既存の記録経路に載せる。

**検証**: `cd strict-goal/server && node --test test/rubric_schema.test.js`（`priority` 追加後もスキーマが通る）、および `priority` 差のある 2 基準で低優先・低得点より高優先・高得点が先頭に来ることを確認する単体テストの追加。

### 改善どうし・既存検査との相互作用

改善どうし・改善と既存検査の干渉を洗い出す。ここを見落とすと、片方の改善が他方を無効化する。

| 組み合わせ | 起きること | 判断 |
|---|---|---|
| 改善3 × `checkScoreJump` | `numeric_roundtrip` のために `exit_code: 0` の command 根拠が常時付くため、**3点超の加点に必要な「command 根拠2件以上」が自動的に満たされる**。急激な加点への歯止めが弱まる | 許容。`checkScoreJump` は加点の*速度*を見る検査であって正当性の検査ではない。正当性は `weakness` と `sg-verifier` が担う |
| 改善4 × `checkEvidenceStale` | 毎周本文を書き直すので locator 根拠の excerpt が変わり、`E_EVIDENCE_STALE` を踏みにくくなる | 望ましい副作用。stale 検査は「同じ引用を貼り直して点だけ上げる」を狙ったもので、本文が実際に変わっているなら発火しないのが正しい |
| 改善4 × `near_total_rewrite` | 毎周 `changed_ratio >= 0.9` で警告が出続ける | 許容。警告であり拒否ではない。ただし**警告の信号価値が下がる**（狼少年化）ので、追記禁止を入れるプリセットでは `near_total_rewrite` を鳴らさない選択肢も要検討（未決事項に記載） |
| 改善6 × `suspicious_shrink` | 予算超過で削る → 前周の 50% 未満で `suspicious_shrink` → 戻す、の振動 | 改善6 を警告に留める最大の理由。拒否にすると `max_rounds` を往復で食い潰す |
| 改善2 × 改善1 | プリセットを正しく選べば（改善1）スコープ外節はそもそも生まれず、改善2 の警告は鳴らない | 改善2 は改善1 の取りこぼし（プリセット選択ミス、課題文の曖昧さ）を拾う二次防壁。単独導入の価値は低い |
| 改善7 × `MUST_FIX_MAX = 3` | 高 priority 基準が 3 枠を占め、他基準の weakness がモデルに届かない | 合否は最小値ゲート（C5）なので収束性は壊れない。ラウンド数増加は §5 で監視する |

---

## 4. 変更一覧

| # | 改善 | 層 | 変更ファイル | 拒否/警告/記録 | 既存互換 |
|---|---|---|---|---|---|
| 1 | プリセット分割 | B | `presets/design.json`, `presets/design.harness.json`(新), `src/rubric/presets.js`, `schemas/tools.json` | なし | 保存済み rubric を読む resume は無影響 |
| 2 | スコープ外節 | A | `src/tools/artifact_commit.js`, `src/rubric/schema.js` | 警告 `out_of_scope_section` | 既定 `[]` で無効 |
| 3 | `numeric_roundtrip` | B | `presets/design.json` のみ | 既存 `E_EVIDENCE_KIND` を流用 | 新規セッションのみ |
| 4 | 追記の報酬除去 + 警告 | B+A | `presets/design.harness.json`, `src/tools/artifact_commit.js` | 警告 `appendix_accretion` | 新規セッションのみ |
| 5 | `defense_tradeoffs` | B | `presets/design.json`, `presets/design.harness.json` | なし | 新規セッションのみ |
| 6 | 分量予算 | A+B | `src/rubric/schema.js`, `src/tools/artifact_commit.js`, `presets/*.json` | 警告 `over_budget` | 未設定なら無検査 |
| 7 | `must_fix` 優先順位 | A | `src/rubric/schema.js`, `schemas/tools.json`, `src/rubric/from_input.js`, `src/tools/score_submit.js` | なし（並び順のみ） | `priority` 既定 0 で順序不変 |

同じ7件を、差分方針・検証コマンド・未決事項の列で再掲する（§3 各項の要約であり、新しい決定は含まない）。

| # | 差分方針 | 検証コマンド（期待終了コード 0） | 未決事項 |
|---|---|---|---|
| 1 | 15 基準を `design.harness.json` へ移設し、`design.json` を汎用8基準へ置換。`VALID_MODES` をプリセット名集合へ一般化 | `node --test test/presets.test.js test/loop_open_resume.test.js` | `design.harness` 以外のドメイン別プリセット（API 設計等）の要否 |
| 2 | `policy.scope_guard_terms`（既定 `[]`）を追加し、フェンス除外後の見出し行に当該語があれば警告 | `node --test test/artifact_commit.test.js test/rubric_schema.test.js` | 既定語彙を配布物に同梱するか、課題ごとに与えるか |
| 3 | `design.json` に基準を1件追加するのみ。command 根拠の強制は既存 `E_EVIDENCE_KIND` に委ねる | `node --test test/evidence.test.js test/presets.test.js` | 根拠コマンドの中身（`echo ok` 回避）の機械検証は不能 |
| 4 | `self_hosting` のアンカー9を反転し、末尾 20% の追記見出しに警告 | `node --test test/presets.test.js test/artifact_commit.test.js` | `near_total_rewrite` が毎周鳴る問題を抑制するか否か |
| 5 | 両プリセットに基準を1件追加するのみ | `node --test test/presets.test.js` | `anti_gaming` との両取りを防げず、抑止力は指摘4の想定より弱い |
| 6 | `policy.artifact_budget_bytes`（任意）を追加し、超過時に警告。design のみ 28,000 を既定値として設定 | `node --test test/artifact_commit.test.js test/presets.test.js` | plan / implement の初期値（実測根拠が design にしかない） |
| 7 | `priority`（0〜3、既定 0）を criteria に追加し、`buildMustFix` を priority 降順 → スコア昇順へ | `node --test test/rubric_schema.test.js test/score_submit.test.js` | `priority` 引き下げを `rubric/diff.js` の緩和分類に含めるかの判定規則 |

**適用順序**: 3 → 5 → 1 → 7 → 4 → 2 → 6。
理由 — 3 と 5 は JSON 追記のみでコード改修ゼロ、効果が最大（指摘2）。1 でスコープ問題の根を断つ。7 は 1 で追加した基準がある前提。4・2・6 は警告機構で、効果が弱く誤検知の調整が要るため最後。

**全体の回帰確認**: `cd strict-goal/server && node --test`（Windows では稀に `EPERM` のリネーム競合でフレークするため、落ちたら 1 回再実行して判断する）。

---

## 5. 効果の測り方

指摘の末尾にある「4本並べて比較」は正しい方針だが、§1.3 のとおり**群の取り違えを避けるため全5群で測る**。同一課題・同一シードで再生成し、以下を並べる。

| 指標 | 測り方 |
|---|---|
| 数式バグ数 | 成果物の数式に境界値を代入する検算スクリプトを課題ごとに用意し、期待値との不一致件数 |
| 規範の矛盾数 | 同一の閾値・既定値が異なる値で 2 箇所以上定義されている件数 |
| 範囲外の節数 | 見出しのうち課題の成果物種別に属さないものの件数（`scope_guard_terms` で機械計数） |
| 文書バイト数 | §1.3 と同じ計測 |
| ラウンド数 | `session.json` の `round`（改善7 の副作用の監視） |

指摘のとおり、**改善3（往復チェック）は他の4方式にも単独で追加して効果を切り分けられる**。プリセット JSON に基準を 1 件足すだけなので、A/B の分離コストが最も低い。まずこれ単独で測ることを勧める。

---

## 範囲外・未決事項

- `presets/plan.json` と `presets/implement.json` への同等の見直し（本書は design のみを対象とした）。
- `design.harness` 以外のドメイン別プリセット（API 設計、データモデル設計等）の要否。
- `internal_consistency` を `verification:"auto"` にした場合の検査コマンドの実体（規範値の重複抽出スクリプト）が未実装。
- `scope_guard_terms` の既定語彙を配布物に同梱するか、課題ごとに与えるかが未決。
- `artifact_budget_bytes` の plan / implement モードでの初期値（design の 28,000B のみ実測根拠がある）。
- ベンチマーク再測定の n が少ない（`strict_single` は n=4）。群間比較の統計的な扱いは未決。
- 改善4 導入時に `near_total_rewrite` 警告が毎周鳴る問題（警告を抑制するか、鳴らしたままにするか）が未決。
- `priority` 引き下げを `rubric/diff.js` の緩和分類に含めるかどうかの判定規則が未定。
- 被指摘成果物の `retryAfterMs` 数式バグそのものの修正は本書の対象外（ハーネス側の改善のみを扱う）。

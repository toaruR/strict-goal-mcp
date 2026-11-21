---
type: decision
status: active
owner: ai
related:
  - docs/plans/archive/design-rubric-scope-and-verification.md
  - docs/plans/archive/impl-record-rubric-scope-and-verification.md
---
# 0004 規範は拘束力の強い層から割り当てる(散文は最後)

## 背景
Rate Limiter クラスの設計課題に、ハーネス向けの design プリセット(15基準)が適用された。
SKILL の「スコープを守れ」という文言は、点数に直結するルーブリックの網羅要求に負け、成果物はスコープ外の節で肥大化した。
散文で書いた優先順位は、判定式(全基準の同格ゲート)にも must_fix の選抜にも入らない。

## 決定
規範はモデルが無視できるかどうかで3層に分け、必ず上の層から割り当てる。

| 層 | 実体 | 拘束力 | 破られ方 |
|---|---|---|---|
| A. サーバ側チェック | score_submit / artifact_commit の fail() と warnings | 最強 | 検査の穴を突く |
| B. ルーブリック基準とアンカー | presets/*.json、policy | 中(点数に直結) | 文言だけ満たす |
| C. スキル文言 | SKILL.md、sg-verifier のプロンプト | 最弱 | 単に守られない |

この原則に沿い、次を層A・Bに実装した。
- design プリセットの分割(design / design.harness)と、スコープ外の節の警告
- 計算で確かめる基準 numeric_roundtrip
- 追記を報酬しないアンカーと、防御策のトレードオフを問う基準 defense_tradeoffs
- 分量予算と、criterion.priority による must_fix の並べ替え

## 結果
- 新しい規範を足すときは、まず層A(検査)か層B(基準)で表現できるかを検討する。層Cだけで済ませない。
- plan / implement プリセットの同様の見直しや、priority を緩和の分類に含めるかの判定など、9項目が未決のまま残っている(impl-record §2)。
- 仕様の詳細は [specification.md §5.5](../spec/specification.md)。

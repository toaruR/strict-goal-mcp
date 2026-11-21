---
type: decision
status: active
owner: ai
related:
  - docs/plans/archive/design-verifier-separation.md
  - docs/plans/archive/design-anti-round1-final.md
---
# 0001 Round 1 即時終了の防止はサーバ側で強制する

## 背景
Gemini・Antigravity 等で、作成エージェントが初回に全基準 9 点を自己申告し Round 1 で FINAL になる問題があった。
先行案(Verifier 分離)は採点を別エージェント sg-verifier に委ねたが、次の理由で破綻した。
- invoke_subagent / Agent() を持たないホストでは委譲が空回りし、結局自己採点になる。
- Verifier は implement 専用で、design / plan には無かった。
- サーバは min_rounds を持たず、9 点が並べば Round 1 でも FINAL を出していた。
- weakness の逃げ文言(「スコープ外」等)が文字数検査を通過した。

## 決定
クライアントの振る舞いに依存せず、サーバのポリシーで反復を強制する。
- `policy.min_rounds`(既定 2)未満では FINAL を出さない。
- 初回スコア上限 `first_round_ceiling` と、初回の必須指摘数 `min_first_round_must_fix` を課す(`E_FIRST_ROUND_UNCRITICAL`)。
- 逃避的な weakness を拒否する(`E_WEAKNESS_EVASIVE`)。

Verifier 分離は、サブエージェントを使えるホストでの追加の防御として残す。

## 結果
- ホストを問わず、最低 2 周の推敲が保証される。
- 本当に 1 周で十分な成果物でも 2 周目が必要になる(コストを受け入れる)。
- 仕様の詳細は [specification.md §5.4](../spec/specification.md)。

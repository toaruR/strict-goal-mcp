---
type: decision
status: active
owner: ai
related:
  - docs/plans/archive/strict-goal-rename-plan.md
---
# 0002 プロジェクト名を rubric-loop から strict-goal に改める

## 背景
「rubric-loop」は仕組み(ルーブリックで反復する)を表す名前で、目的が伝わらなかった。
本ハーネスの価値は、AI の妥協・早期完了宣言を防ぎ、客観的な検証に通るまでゴール達成を強制することにある。

## 決定
- プロジェクト名・パッケージ・スキル・ドキュメントを strict-goal に統一する。
- 環境変数は `STRICT_GOAL_DATA` を優先し、`RUBRIC_LOOP_DATA` をフォールバックとして残す(段階的移行)。
- リポジトリ名(rubric-loop-mcp)と過去の設計書内の旧名は書き換えない。

## 結果
- 利用者は目的から名前を想起できる。
- 旧名の環境変数を使う既存環境は、そのまま動き続ける(strict-goal/server/src/paths/plugin_data.js)。
- 旧名が設計書・履歴に残るため、両方の名前が混在する。

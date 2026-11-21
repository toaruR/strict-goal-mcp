---
type: decision
status: active
owner: ai
related:
  - docs/plans/archive/subagent-implementation-plan.md
  - docs/plans/archive/hierarchical-task-subagent-plan.md
---
# 0003 implement は親・子・孫の3層サブエージェントで実行する

## 背景
implement フェーズのテスト出力や試行錯誤の履歴が親エージェントのコンテキストに溜まり、トークン消費と判断の劣化を招いていた。
委譲の方式として次の3案を比較した。

| 案 | 長所 | 短所 |
|---|---|---|
| 1. フェーズ丸ごと委譲(子が loop_open〜FINAL を自律周回) | 親のコンテキストを完全に保護。通信オーバーヘッドが最小 | 子が長引くと親から監視しにくい |
| 2. 親が採点、子は修正のみ(Orchestrator-Worker) | 改ざん防止が最も強い。進行が親から見える | 周回ごとに親子の往復が発生する |
| 3. タスク単位で並行委譲(Swarm) | 独立タスクを速く消化できる | fileset マニフェストやテストインベントリの統合で競合しやすい |

## 決定
案1を基本とし、子の肥大化を防ぐために孫を加えた3層にする。
- 親(メイン): ユーザー対話と、design / plan の完遂。sg-implementer を起動して最終結果を確認する。
- 子(sg-implementer): implement セッションを監督する。plan のタスクを1件ずつ順に孫へ委譲し、fileset のコミットと採点の周回を回す。
- 孫(sg-worker): 1タスク(または must_fix 1件)を実装し、単体テストを通して破棄される。
- 並行(案3)は採らない。統合時の競合を避けるため、順次委譲にする。

## 結果
- 親と子のコンテキストが、タスクの実装の詳細から隔離される。
- 孫は極小のコンテキストで作業するため、局所的な精度が上がる。
- 起動回数が増え、ホストごとのサブエージェント定義(.claude / .codex / .agents)の保守が必要になる。
- 構成の詳細は [specification.md §5.2](../spec/specification.md) と [subagent-workflow.md](../spec/subagent-workflow.md)。

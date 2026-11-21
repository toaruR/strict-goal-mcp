# ドキュメント索引

<!-- docs-index:begin (docs_lint.py --write-index が自動生成。手で編集しない) -->

## 仕様

| 文書 | 更新 |
|---|---|
| [strict-goalの人間による承認](spec/chat-approval.md) | 2026-11-21 |
| [rubric ループ実行 MCP サーバ 設計書](spec/design-rubric-loop-mcp.md) | 2026-11-21 |
| [strict-goal MCP の SKILL.state 化改良計画 設計書](spec/design-skill-state-mcp.md) | 2026-11-21 |
| [strict-goal round・時間・token削減 設計仕様](spec/design-strict-goal-round-reduction.md) | 2026-11-21 |
| [仕様書](spec/specification.md) | 2026-11-21 |
| [設計から実装までのサブエージェント呼び出しフロー (strict-goal-agy)](spec/subagent-workflow.md) | 2026-11-21 |
| [strict-goal バージョン管理およびバージョン確認仕様書](spec/version-specification.md) | 2026-11-21 |

## 決定記録

| 文書 | 状態 | 更新 |
|---|---|---|
| [0001 Round 1 即時終了の防止はサーバ側で強制する](decisions/0001-server-enforced-anti-round1.md) | active | 2026-11-21 |
| [0002 プロジェクト名を rubric-loop から strict-goal に改める](decisions/0002-rename-to-strict-goal.md) | active | 2026-11-21 |
| [0003 implement は親・子・孫の3層サブエージェントで実行する](decisions/0003-hierarchical-subagents.md) | active | 2026-11-21 |
| [0004 規範は拘束力の強い層から割り当てる(散文は最後)](decisions/0004-rubric-binding-layers.md) | active | 2026-11-21 |
| [0005 起動コマンドは /strict-goal に限り、/goal スキルは置かない](decisions/0005-strict-goal-command-only.md) | active | 2026-11-21 |
| [0006 人間の承認はトークンファイルではなくチャットの返答で受け付ける](decisions/0006-chat-approval.md) | active | 2026-11-21 |

## ガイド

| 文書 | 更新 |
|---|---|
| [Round-reduction migration and rollout](guides/strict-goal-round-reduction-migration.md) | 2026-11-21 |
| [テストガイドラインとハマりポイント](guides/testing.md) | 2026-11-21 |

## 調査

| 文書 | 更新 |
|---|---|
| [追補合議: strict-goal改善案へのagy参加](gougi/2026-10-16-strict-goal-round-reduction-agy-supplement.md) | 2026-11-21 |
| [合議: strict-goalのround・時間・token消費を品質を保って減らす](gougi/2026-10-16-strict-goal-round-reduction.md) | 2026-11-21 |
| [Agent Plugins 1.0.0 メモ（外部仕様）](research/2026-09-05-agent-plugins-notes.md) | 2026-11-21 |
| [本ドキュメントについて](research/2026-09-05-memo.md) | 2026-11-21 |
| [SKILL.state化 検討メモ](research/2026-09-13-skill-state-investigation-memo.md) | 2026-11-21 |
| [Codex の spawn 検出と state-only 委譲](research/2026-09-17-codex-state-only-delegation.md) | 2026-11-21 |
| [Sliding Window Counter Rate Limiter 設計仕様書](research/2026-09-20-rate-limiter-spec-sample-7.md) | 2026-11-21 |
| [Sliding Window Counter Rate Limiter 設計仕様](research/2026-09-20-rate-limiter-spec-sample.md) | 2026-11-21 |
| [strict-goal round削減: 合議送信内容の確認](research/2026-10-16-strict-goal-round-deliberation-request.md) | 2026-11-21 |
| [strict-goal round増加の調査: idle-talk事例](research/2026-10-16-strict-goal-round-investigation.md) | 2026-11-21 |
| [strict-goal 設計フェーズにおける品質すり抜け分析と改善指針](research/2026-10-17-strict-goal-design-review-analysis.md) | 2026-11-21 |
| [サブエージェントの入力トークン調査](research/2026-10-18-codex-session-tokens-analysis.md) | 2026-11-21 |
| [Codex Session Token Report](research/2026-10-18-codex-session-tokens.md) | 2026-11-21 |
| [Codex strict-goal の state-only 委譲監査](research/2026-10-18-codex-state-only-delegation-audit.md) | 2026-11-21 |

## 計画

| 文書 | 状態 | 更新 |
|---|---|---|
| [strict-goal ラウンド削減設計（v2）の全体像](plans/round-reduction-design-summary.md) | active | 2026-11-21 |

アーカイブ済みの計画: 20 件(`plans/archive/`)

<!-- docs-index:end -->

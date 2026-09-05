# [Rename] rubric-loop から strict-goal-mcp への移行計画

「サボらせない・厳格にゴールを完遂させる」という価値・目的に合わせ、プロジェクト名および関連するディレクトリ・設定・ドキュメントを rubric-loop から strict-goal-mcp にリネーム・刷新する。

## 変更方針

1. プロジェクト名・価値の再定義
   - 「AIの妥協・サボりを防ぎ、客観的なルーブリック検証をパスするまで厳格にゴール達成を強制する」ハーネスとしてリブランディング。
2. 安全な段階的移行
   - 環境変数やディレクトリ参照は後方互換性を保ちつつ（STRICT_GOAL_DATA を優先、RUBRIC_LOOP_DATA をフォールバック）、新しい名前に切り替える。
3. 影響範囲の整理
   - パス解決（plugin_data.js 等）
   - プラグイン・MCP設定（plugin.json, mcp.json, package.json）
   - スキル定義（skills/）
   - ドキュメント（README.md, README.ja.md, CLAUDE.md 等）

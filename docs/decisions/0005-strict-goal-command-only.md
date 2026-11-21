---
type: decision
status: active
owner: ai
related:
  - docs/plans/archive/strict-goal-human-ux-and-goal-command-plan.md
---
# 0005 起動コマンドは /strict-goal に限り、/goal スキルは置かない

## 背景
当初の計画では、ホストで定番の `/goal <指示>`(目標を完遂するまで自律実行する)を strict-goal につなぐため、`goal` スキルを追加した。
しかし Antigravity / Claude Code / Codex には同名の標準コマンドがあり、同名のスキルを定義すると標準コマンドを乗っ取る(ハイジャックする)ことが分かった。

## 決定
- `goal` スキルは削除する(06e727d)。
- strict-goal の起動トリガーは `/strict-goal` と、人語の「strict-goal で〜して」に限る。
- 人語の指示から design → plan → implement を回し切る、という計画の目的は strict-goal スキルが引き継ぐ。

## 結果
- ホスト標準の `/goal` の挙動を壊さない。
- `/goal` という覚えやすい入口は失う。
- 今後スキルを追加するときは、ホスト標準のコマンドと同じ名前を避ける。

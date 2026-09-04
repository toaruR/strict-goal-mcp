# 本ドキュメントについて
**本ドキュメントは、指示ではなく作業メモなので参考にしてはならない**

## 1 設計を作るためのルールを作る
### 1-1 rubricループを作成
TXT(添付)
ワンショットでループさせる思想のプロンプト例を添付した。
「rubricループで設計をするためのMCP」の設計を作るrubricループのワンショット用プロンプトを作ってみて
→docs\design-rubric-loop-mcp.txt

### 1-2 追加資料
docs\design-rubric-loop-mcp.txt に移動した。
Claude以外は、
  [Agent Plugins](https://agent-plugins.org/compatible-clients) 
に準拠してほしい
→docs\design-rubric-loop-mcp.txt 更新
→docs\agent-plugins-notes.md

## 2 設計を作る
docs\design-rubric-loop-mcp.txt を実施
→docs\design-rubric-loop-mcp.md
※ココが冗長だったかあるいは、2-2が冗長だったか。まぁでも下敷きになるので良いか

### 2-1 MCP新規規格を思い出した
https://modelcontextprotocol.io/specification/2026-07-28/changelog
最近MCPの規格が変わってステートレスになった
これには対応しているか？
→docs\design-rubric-loop-mcp.md 更新

### 2-2 機能追加rublicループを作ってもらう
docs\design-rubric-loop-mcp.md は
を進化させるよ
- 設計を回すモード（現在の設計が目指した物）
- できた設計から実装計画を回すモード
- できた実装計画から実装を回すモード
をこの設計書に追加するrubricループのワンショット用プロンプトを作ってみて
→ docs/design-rubric-loop-modes.txt

### 2-3 機能追加rublicループを実施
docs/design-rubric-loop-modes.txt を実施

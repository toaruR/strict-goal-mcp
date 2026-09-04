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
→docs\design-rubric-loop-mcp.md 更新

## 3 実装計画を作るためのルールを作る
### 3-1 冗長だが、実装計画を作るためのrubricループを作成
docs\design-rubric-loop-mcp.md
の実装計画を立てるためのrubricループプロンプトを作って
→ docs\plan-rubric-loop-mcp.txt

## 4 実装計画を作る
docs\plan-rubric-loop-mcp.txt  を実施
→docs\plans\rubric-loop-implementation-plan.md
KICKBACK（設計書側の欠陥・計画には反映せず）の指摘、提案があった

### 4-1 KICKBACKで再設計
docs\plans\rubric-loop-implementation-plan.md
のKICKBACK（設計書側の欠陥・計画には反映せず）を読んで、
docs\design-rubric-loop-mcp.md を修正して(ループではなく鵜呑み)
→docs\design-rubric-loop-mcp.md更新

### 4-2 設計の修正を実装計画作成rubricループに反映
docs\design-rubric-loop-mcp.md の更新に伴って、
docs\plans\rubric-loop-implementation-plan.md も更新して（ループでない）


## 5 実装
docs\plans\rubric-loop-implementation-plan.md を読んで実装に進んでください



## 6 未実装確認
これどうしようかね
これはルブリックループじゃなくていいかな？

## 7 補完設計を作るためのルールを作る
ここからはドッグフーディングしたい

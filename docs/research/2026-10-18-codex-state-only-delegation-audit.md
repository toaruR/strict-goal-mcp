---
type: research
---

# Codex strict-goal の state-only 委譲監査

確認日: 2026-10-18（日本時間）。対象実行: 親 `01a14552-3860-7a61-8132-93e1223d1e3e`、実装監督 `01a14724-c700-7562-8f1f-e1a51fa98b01`。

## ユーザー修正後の再確認

最新の再検査では `.codex/skills/strict-goal/SKILL.md` にも none・include: []・新規子起動の規約が入り、前回指摘した旧内容の別コピーは解消した。`.agents/skills/strict-goal/SKILL.md`、`.codex/skills/strict-goal/SKILL.md`、`.codex/agents/sg-implementer.toml` の3ファイルは、更新元の対応ファイルとバージョンコメント・改行を除いて一致。TOML構文解析成功。subagents / skill_md / skill_state_projector の計21件成功。サーバーのテストディレクトリ（このチェックアウトと更新元）には fork_turns の明示的な検査が引き続き見つからず、修正後の実際の子起動ログによる受入確認も未実施。

以下の段落は、その前の再確認時点の記録。

同日、`.agents/skills/strict-goal/SKILL.md` と `.codex/agents/sg-implementer.toml` の修正を確認。両方に fork_turns="none"、直前の skill_state 取得（include: []）、作業単位ごとの新規子起動を要求する規約が入っている。スキルはメッセージを `{skill_state, transaction, paths, output_contract}` に限定し、Codex TOML も spawn_agent を直接指定している。

実際のキット配布元 `D:\vagrant\harnesses\simple\strict-goal-mcp` の対応する2ファイルとも、バージョンコメントと改行を除いて内容が一致。TOML の構文解析成功、`subagents.test.js` / `skill_md.test.js` は計20件成功。

一方、`.codex/skills/strict-goal/SKILL.md` は state-only 手順がない別コピーのまま。また上記2テストに fork_turns / state-only / stateless の検査はなく、同期対象も sg-implementer を含まないまま。修正後の実際の Codex spawn による受入確認は行っていない。

以下は修正前の実行とファイル状態についての記録。

## 結論

state-only の設計とサーバー側の投影処理は存在する。しかし、今回の実行が参照した Codex 用スキル・エージェント定義には履歴非継承の具体的な規約がなく、実際の実装監督からの16回の子起動はすべて `fork_turns="all"` だった。既存仕様が実際の配布・実行経路に届いていない。

## 設計・配布物の照合

| ファイル | fork_turns="none" / state-only の具体的な起動手順 |
|---|---|
| `strict-goal/skills/strict-goal/SKILL.md:53` | あり。直前の skill_state 取得、include: []、新規子、限定されたメッセージ、none の明示を要求 |
| `.agents/skills/strict-goal/SKILL.md:53` | なし。SKILL.state による状態復帰の説明はあるが、Codex の state-only child transactions 節がない |
| `.codex/skills/strict-goal/SKILL.md` | なし |
| `.agents/agents/sg-implementer.md:15` | あり。none と SKILL.state-only handoff を明記 |
| `.claude/agents/sg-implementer.md:15` | あり |
| `.codex/agents/sg-implementer.toml:12` | なし。Agent/invoke_subagent、担当タスク、Workspace: inherit の説明のみ |
| `strict-goal/agents/sg-implementer.md` | なし |

`Workspace: inherit` は作業場所の指定であり、会話履歴非継承の `fork_turns="none"` を代替しない。

## 実行ログの照合

ログディレクトリ: `C:\Users\<user>\.codex\sessions\2026\10\17\`。

- 親ログ `rollout-2026-10-17T00-26-18-01a14552-3860-7a61-8132-93e1223d1e3e.jsonl` の16、23、754、1182行に、`.agents/skills/strict-goal/SKILL.md` を読む custom_tool_call を確認。実装監督の起動は1194行で、`fork_turns` は省略。
- 実装監督ログ `rollout-2026-10-17T08-55-55-01a14724-c700-7562-8f1f-e1a51fa98b01.jsonl` の4行目に注入された developer 指示の先頭部分は、現在の `.codex/agents/sg-implementer.toml` の developer_instructions と改行正規化後に一致。役割指示4232文字には none・state-only handoff の規約がない。
- 同監督の spawn_agent は16件、すべて `fork_turns="all"`。例: t001 は87行、t009 は772行、verifier_r1 は1445行。
- 同監督の custom_tool_call 内で確認できた loop_state 呼び出しは59、697、1476行の3件。いずれも projection:"skill_state" だが、include は upstream/history/chain 等を含み、include: [] ではない。16回の各起動直前に fresh state を取得する手順にはなっていない。
- 起動メッセージ本文は暗号化されていたため、本文が厳密に `{skill_state, transaction, paths, output_contract}` だけだったかは判定していない。fork設定・公開された実行コード・注入指示を根拠としている。

## 配布経路と履歴

`.knowledge-kit/source.json` の更新元は `D:\vagrant\harnesses\simple`。その `install_kit.py` は以下の経路を使用する。

- 120〜122行: Codex 用 strict-goal スキルの入力は `strict-goal-mcp/.agents/skills/strict-goal`。`strict-goal/skills/strict-goal` からは配布しない。
- 143〜145行: クライアント別のエージェント定義を個別のソースとする。
- 668〜675行: Codex 用 TOML が存在すれば、そのファイルを同期し、Markdown から再生成しない。

更新元 `D:\vagrant\harnesses\simple\strict-goal-mcp` でも上表と同じ欠落を確認。単に移植先が更新されていないだけではなく、実際に配布される更新元にも規約がない。

2026-09-17 の `d9f4a5d` は、配布元スキル `strict-goal/skills/strict-goal/SKILL.md` と `.agents/agents/sg-implementer.md` に規約を追加したコミット。現在の Codex 用スキル・TOMLとは別の保守箇所である。Codex TOML が追加されたコミットは翌日の `c972f10`。

## サーバー機能と検査の境界

`strict-goal/server/src/tools/loop_state.js:131` は projection:"skill_state" の場合に projectSkillState を呼び、currentArtifact を抑制する。これは状態データの投影であり、Codex の spawn_agent 引数を書き換える機能ではない。

`strict-goal/server/test/subagents.test.js:16` の同期対象は sg-worker / sg-verifier / sg-designer で、sg-implementer は含まれない。80行からの sg-implementer 検査も sequential・loop_open・helper.js・sg-worker 等の存在確認で、none 規約を検査しない。`subagents.test.js` と `skill_md.test.js` に fork_turns / state-only / stateless の検査は見つからない。

`skill_state_projector.test.js` を実行し、1件成功を確認した。既定の TEMP ではサンドボックス内の rename が EPERM になったため、プロセスの TEMP/TMP を作業場所内 `.audit-test-tmp` に限定して実行し、終了後に環境変数を復元した。

```powershell
node --test --test-isolation=none strict-goal/server/test/skill_state_projector.test.js
```

このテストは投影機能の検証であり、実際の Codex 子起動の履歴非継承を保証するものではない。

## 修正に必要な範囲

既存規約を、実際の配布元である `.agents/skills/strict-goal` と `.codex/agents` に反映し、親→監督と監督→作業員の両方で none を要求する必要がある。加えて配布コピーの同期検査と、実ログの fork 設定を確認する受入検査が必要。none による削減率は実測が必要で、共通指示・ツール定義の入力や、子自身の長期処理による入力増大は別途残る。

本調査では動作を変える修正は行っていない。

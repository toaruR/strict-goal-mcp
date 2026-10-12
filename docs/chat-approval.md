# STALLED時のチャット承認

通常のMCP呼出しでは、停滞時の判断をチャット上で受け付ける。ユーザーによるトークンの読み取り・貼り付けは不要。

1. サーバーが `STALLED` を返すと、エージェントが `escalate(action:"request_human")` を呼ぶ。
2. サーバーは `ESCALATED` に移行し、`channel:"chat"` の確認IDと判断用の概要を返す。トークンファイルは作らない。
3. エージェントは停滞理由と未達項目を示し、「続行／現状受入れ／基準緩和／中止」の選択をチャットで尋ね、返答を待つ。
4. 明示的な返答後、エージェントが `escalate(action:"resolve")` に確認ID、選択、返答原文を渡す。

例：「もう少し続けて」とユーザーが返答した場合の入力（`session_id` は実際の値に置き換える）：

```json
{
  "session_id": "rl_00000000000000000000000000",
  "submission_id": "chat-approval-001",
  "action": "resolve",
  "escalation_id": "esc_01",
  "resolution": "continue",
  "human_reply": "もう少し続けて",
  "note": "ユーザーからこの停滞確認に対して続行するよう明示的な返答があったため、追加周回を行う。"
}
```

| 選択 | `resolution` | 結果 |
|---|---|---|
| 続行 | `continue` | 追加周回を付与し `DRAFTING` に戻る |
| 現状受入れ | `accept_as_is` | `FINAL_WITH_RELAXATION` として終了、未達の受入れを監査記録に残す |
| 基準緩和 | `relax_rubric` | 緩和の承認を記録し `SCORING` に戻る。基準変更は既存の `rubric_amend` 手順 |
| 中止 | `abort` | `ABORTED` として終了 |

「続行してよい？」への「はい」のように選択が一意なら許可として扱う。複数の選択肢への単なる「はい」など曖昧な返答は確認し直す。沈黙・時間経過・通常のタスク開始許可から選択を推測しない。

サブエージェントは確認ID・理由・未達項目を親へ渡し、親がユーザーへの確認と返答の引き渡しを担当する。返答が届くまで変更・採点・再開を行わない。コンテキストを失った場合も `loop_state(projection:"skill_state")` または `loop_open(mode:"resume")` の `next_action` から保留中の確認IDを取得できる。

サーバーは確認ID・返答の存在・未消費状態を検査し、返答原文と選択を保存する。返答の発言者認証は行わず、実際にユーザーへ確認して待つ責任はエージェントの手順に置く。

旧トークン方式は `request_human` に `approval_channel:"token_file"` を指定した場合、および既存のトークンを持つセッションとの互換用に残す。MRTR対応経路は維持し、明示的に `approval_channel:"chat"` を指定すればチャット方式を使用できる。自動的な基準緩和承認の既存経路や `reopen` / `kickback` は今回の変更範囲外。

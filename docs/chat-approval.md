# strict-goalの人間による承認

人間の判断を必要とする操作は、保留中の確認ID（escalation_id）とチャット返答原文（human_reply）で承認する。秘密ファイルの生成・読み取り・貼り付けは行わない。

## 承認要求と待機

- STALLED: escalate(action:"request_human", approval_channel:"chat", approval_action:"resolve") を呼び、理由と続行・現状受入れ・基準緩和・中止の選択を提示する。
- score_submitによる自動ESCALATED: チェーン予算超過または基準緩和の承認待ちでは、既に確認IDが作成されている。返されたnext_actionを使い、request_humanを再実行しない。
- kickback: request_humanにapproval_action:"kickback"とtarget_criteriaを指定する。上流の欠陥と差し戻す基準を提示する。
- reopen: サーバーがFINALまたはFINAL_WITH_RELAXATIONを返したセッションで、request_humanにapproval_action:"reopen"を指定する。確定成果物を再改訂する理由を提示する。

全ての呼出しにsession_id、8文字以上の新しいsubmission_id、action、40–4000文字のnoteが必要。ユーザーの明示的な返答まで変更・採点・再開を止める。単一の操作を提示した質問への「はい」「ok」も承認として扱える。複数の選択肢への曖昧な返答、沈黙、時間経過、通常のタスク開始許可から判断を推測しない。

サブエージェントは確認ID・理由・提案する操作を親へ渡し、親がチャットでユーザーへ確認して返答を引き渡す。コンテキストを失った場合はloop_state(projection:"skill_state")またはloop_open(mode:"resume")から保留中のnext_actionを回収する。

## 承認を反映する

```json
{
  "session_id": "rl_00000000000000000000000000",
  "submission_id": "chat-approval-001",
  "action": "resolve",
  "escalation_id": "esc_01",
  "resolution": "continue",
  "human_reply": "計画セッションの続行を承認します",
  "note": "ユーザーがこの計画セッションの承認待ちに対して続行を明示的に選択したため、追加周回を行う。"
}
```

| 操作 | 承認後の結果 |
|---|---|
| resolve / continue | DRAFTINGへ戻りセッションの周回枠を3増やす。チェーン予算超過時はチェーン枠を6増やす（1回限り）。 |
| resolve / accept_as_is | FINAL_WITH_RELAXATIONとして終了し、未達の受入れを監査に記録する。 |
| resolve / relax_rubric | 緩和の承認を記録しSCORINGへ戻る。基準変更にはrubric_amendを使う。 |
| resolve / abort | ABORTEDとして終了する。 |
| kickback | 同じtarget_criteriaを添えて実行し、上流をDRAFTINGへ再開、下流をFROZENへ凍結する。 |
| reopen | 確定成果物に紐付く確認を消費し、自セッションを次ラウンドのDRAFTINGへ再開する。 |

kickbackとreopenにも返された確認IDとhuman_replyを渡す。resolutionは付けず、返されたinput_skeletonを使う。目的付きの確認を別操作に流用できない。kickbackまたはreopenの確認をresolveで処理できるのは、ユーザーが明示的に終了を選んだabortのみ。単に差し戻し・再開を拒否した返答から終了許可を推測しない。

サーバーは最新の保留中ID、返答の存在、目的、対象基準・成果物、操作の前提条件を検査し、確認を一度だけ消費する。返答原文、選択、消費時刻を監査に保存する。発言者の認証は行わず、実際のユーザー返答を得る責任はエージェントの手順に置く。前提条件エラーでは確認を消費せず、エラー理由を確認する。

## 既存記録とMRTR

旧サーバーで作られた保留中JSONも、確認IDとチャット返答で処理できる。付随する秘密ファイルは参照せず、その値を承認に使わない。既存ファイルは履歴として保持し、消費時にJSONを現在の監査形式へ正規化する。廃止された承認パラメータ・承認経路は入力検証で拒否する。

MRTR対応クライアントのelicitationとinputResponsesによる返答経路は継続する。通常のチャットではapproval_channel:"chat"を指定する。MRTR非対応時と自動ESCALATED時はチャット確認になり、秘密ファイル方式へ切り替わらない。実行中のサーバーは更新後に再起動する。

# Codex の spawn 検出と state-only 委譲

2026-09-17、対象実行 `bn_D1AM01R88BVW9SJXM0W0C0J8E4` を調査。

## 観測事実

- 親 `01a0aded-5acc-7892-846b-c9dedddd8967` の保存 rollout に `collaboration.spawn_agent` と成功応答 `/root/sg_verifier` が存在。
- `SubAgentActivity.started` の子 ID は `01a0adef-eabb-7ec0-a17b-c4879b652fb8`。子自身の session_meta にも一致する親 ID が存在。
- この spawn は既に `fork_turns: "none"` を指定していた。以後は同じ子を3回再利用し、計4回の完了記録がある。
- `codex exec --json` 出力にはこの spawn 活動が現れず、`wait_agent` は宛先なしの legacy wait として出力された。従来の `spawns=0, empty_waits=4` による失格判定は誤検出。

## 修正

`strict-goal-benchmark/src/tracker/codex_hierarchy.js` は exec の thread ID に一致する親 rollout の活動記録を照合する。成功した spawn と `fork_turns: "none"` の call ID を対応させ、履歴非継承指定も検証する。保存記録を取得できない場合、その指定を検証済みとは扱わない。ベンチマークはコンパクトな `hierarchy_evidence.json` を保存し、非継承指定が確認できない試行は受理しない。

スキルとベンチマークの指示は、各トランザクションで新規の子を作り、`loop_state({session_id, projection: "skill_state", include: []})` の `skill_state` フィールドと担当作業・必要パス・出力契約だけを渡す。同一子を次ラウンドで再利用しない。これは指示上の制約であり、判定器がメッセージ本文や全ての子の再利用まで機械的に検証するわけではない。

`fork_turns="none"` は親会話の継承を止める。共通システム指示・ツール定義等のキャッシュ利用を無効化する指定ではない。元実行の368万トークンを「親履歴のforkだけ」が原因とは判断できない。

## 検証

- ベンチマークテスト16件成功、ランナー構文検査成功。
- 対象の保存ログを修正版で再判定: spawns=1, skill_state=1, empty_waits=0, stateless_verified=true。
- 配布用スキルとローカルスキルの構造検証成功。
- 大量トークンを消費する実ベンチマーク全体の再実行および過去レポートの上書きは行っていない。新規子を毎回作る指示による削減量は未計測。

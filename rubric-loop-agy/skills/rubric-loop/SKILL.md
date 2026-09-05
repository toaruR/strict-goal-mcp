---
name: rubric-loop
description: 設計・実装計画・実装を、サーバ側の rubric 判定で合格するまで回す。設計書を書く / 実装計画を立てる / 計画どおり実装する、のいずれかを頼まれたときに使う。
---

## 原則

合格・不合格を決めるのはあなたではなくサーバである。あなたの仕事は、成果物を出し、
根拠つきで自己採点し、サーバが返す must_fix を潰すこと。自分で「もう十分だ」と判断しない。
FINAL はサーバのみが出す判定であり、モデルが自ら FINAL を宣言することは禁止されている。

## モードの選び方

| 頼まれたこと | loop_mode | 上流 |
|---|---|---|
| 要求から設計書を作る | design | 不要 |
| 確定した設計書から実装計画を作る | plan | 設計セッションのハンドルと成果物ダイジェスト |
| 確定した計画からコードとテストを書く | implement | 計画セッションのハンドルと成果物ダイジェスト |

上流のダイジェストが分からなければ、上流セッションで loop_state を呼んで取る。
推測で埋めない（間違っていればサーバが E_UPSTREAM_DIGEST_MISMATCH で拒否する）。

## 手順

1. loop_open を呼ぶ。新規なら mode:"create" + loop_mode + task + rubric_preset、
   再開なら mode:"resume" + session_id。submission_id は毎回ユニークな文字列を作って渡す。
2. 返ってきた next_action に従う。以後この繰り返し。
3. artifact_commit — 毎回、成果物の全文を出す（差分ではない）。
   expected_round はサーバが返した round をそのまま入れる。
   addresses には、前回の must_fix の先頭にある基準 id を必ず含める。
   - loop_mode:"implement" では content ではなく files + manifest_command +
     manifest_output_sha256 + test_inventory を渡す。
     テストファイルを変更したなら、そのファイルの差分を test_inventory.diffs に入れる。
4. score_submit — 全基準に点数・理由（40文字以上）・弱点・根拠を付ける。
   甘く付けても得はない。サーバは前回との差と根拠を見ており、
   根拠のない上昇は E_SCORE_INFLATION で拒否される。
   - 上流の記述に対応させた点は kind:"upstream" の根拠で示す。
   - implement ではコマンド根拠に target_digest（直前の artifact_commit が返した digest）を必ず入れる。
5. サーバが判定した結果が FINAL なら終了。ITERATING なら must_fix を潰して 3 に戻る。FINAL を出すのはサーバのみである。

## 上流が変わったと言われたら

state が SUPERSEDED になったら、loop_state{include:["upstream"]} で新しい上流を読み、
escalate{action:"rebase", upstream_digest:<current>} を呼ぶ。
サーバが「どの基準を採点し直す必要があるか」を返すので、それだけを直す。全部やり直さない。

## 上流が間違っていると気づいたら

下流で辻褄を合わせない。escalate{action:"kickback", target_criteria:[…], note:"欠陥の説明"} を
提案し、人間の承認トークンを求める。あなたのセッションは凍結され、上流が直ってから再開する。

## 文脈を失ったとき

session_id だけを頼りに loop_state を呼ぶ。
必要な情報は全部返ってくる。思い出そうとしない。

## ツールが使えないとき（縮退）

MCP サーバが起動していない、あるいは障害で使用できない場合は、FINAL を名乗らない。
成果物の冒頭に必ず以下の文字列を書く。

UNVERIFIED-COMPLETE: rubric-loop server unavailable

fallback journal の保存先はワークスペースの `./rubric-loop-fallback.json`（または `.rubric-loop/fallback-journal.md`）とする。

3モードそれぞれの縮退要件:
- design — rubric の各基準を文書内に列挙し、自己採点表（点数・理由・弱点）を成果物の末尾に付ける。自ら FINAL を名乗らない。
- plan — 同上に加えて、タスクの依存が循環していないことを自分でトポロジカルソートして示す。design_refs は手で設計書の見出しと照合する。自ら FINAL を名乗らない。
- implement — 同上に加えて、テストの実行結果（コマンド・終了コード・件数）を必ず貼る。この成果物をマージ・デプロイしてよいとは主張しない。人間のレビューを明示的に求める。自ら FINAL を名乗らない。

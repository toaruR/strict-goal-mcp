# strict-goal round増加の調査: idle-talk事例

調査日: 2026-10-16 JST。ユーザー指定の `D:/vagrant/idle-talk/.strict-goal` を主対象とする。古い実行例は原因判断に使用しない。アプリ・MCP実装・既存実行記録は変更していない。

## 確認した事実

| phase | session ID | roundカウンタ | 採点JSON件数 | 基準数 | FINAL記録 |
|---|---|---:|---:|---:|---|
| design | rl_01M4N7XDADJXXEFWEQR9WN0QM2 | 13 | 13 | 8 | 13 |
| plan | rl_01M4NB4VGY4MXQC5APJEJV2K7X | 11 | 11 | 8 | 7, 9, 11 |
| implement | rl_01M4NGD7BD7V0YQB865HSARHMC | 13 | 11 | 9 | 13 |
| 合計 | 同一chain | 37 | 35 | — | — |

- 実装round 3と10の採点JSONは存在しない。10には `E_CHAIN_BUDGET_EXHAUSTED` の拒否記録がある。3は今回確認した保存ファイルから採点内容を復元できない。37回すべて採点成功したとは扱わない。
- 保存済み拒否記録はdesign 3件、implement 3件。35件の採点記録と6件の拒否記録は別の数である。
- planはround 7でFINALになった後、実装からの2回のkickbackを経てround 9、11でもFINALになっている。
- 全体の作成〜最終更新は2026-10-11 19:25〜2026-10-12 14:43 JST、約19時間19分。ただし途中休止・承認待ち・並行するphaseを含むため、AI実処理時間ではない。
- escalation JSONはdesign 1件、plan 3件、implement 4件。created_at〜consumed_atのphase別合計は約4.5/98.1/66.4分で、これは待ち時間の参考値に限る。phase間の重複や人の検討時間を含み、単純合算して実処理時間から差し引かない。
- token数、課金、モデル実呼び出しログ、クライアント別の統制比較は取得していない。

## 長引いた箇所

### 1. 実機検証と今回の納品範囲が途中まで一致していない

実装round 8ではpytest 305 passed、live 29件除外、既定test inventory 329件/failed 0/skipped 0/exit 0にもかかわらず `tests_green=8`。弱点は実機・外部サービス検証未実施だった。実装round 13でもlive検証はユーザーの範囲決定で除外したままだが、同基準は9点。

これはlive除外が初めから妥当だったと証明するものではない。計画が実機成果物まで要求していたなら当初の未達指摘は正当であり、範囲確定・上流計画更新の時点と採点への反映を追う必要がある。未実行テストを単にinventory外へ移すだけの改善は不可。

### 2. 採点の追加要求と9点anchorにずれがある

保存rubric `implement/rubric/1.json` の9点anchorとの比較:

| 基準 | 9点anchorの要旨 | 途中の8点・7点理由 | 最終round 13の状態 |
|---|---|---|---|
| tests_green | failed 0、exit 0、skipped非増 | live試験除外、同一digestなので据え置き | live除外の弱点を残して9 |
| no_unplanned_change | 計画path集合内、又はchange_noteで個別正当化 | 計画変更が事後的だった | 事後的変更の弱点を残して9 |
| docs_updated | 公開IF変更が文書へ反映され実物と一致 | READMEに機械検査がない | 手動監査で実際の不一致3件を直し、機械検査なしで9 |

途中の減点すべてが誤りとは言えない。READMEには最終的に修正された実際の不一致もある。一方、機械検査がないことや事後的変更という履歴だけを、現在のanchor不達と同一視する理由はrubricから読み取れない。

### 3. 同じ成果物を正しく再評価する経路と水増し防止が衝突

- 実装round 8/9は同じ成果物digest。round 9の `no_unplanned_change:7→9` は `E_SCORE_INFLATION` で拒否。
- round 9は上流の現行FINAL計画に照合し直しても7点に据え置かれ、弱点欄に同一digest制約が明記されている。
- round 11の `tests_green` は「in-scope欠陥は見つからないが同一digestなので据え置き」と記載。
- 現行 `judge/anti_gaming.js` は成果物digest不変時の増点を拒否する。上流の承認済み計画・範囲が変わった場合や、過去の採点誤りを訂正する場合の正当性とは区別していない。
- ただし採点規則を緩めるだけでは水増し防止を壊す。今回確認した衝突が、常に増点を認める根拠にはならない。

### 4. 全体の不足があるのに修正への返却は上位3件

現行 `score_submit.js:87` の `buildMustFix` は不合格基準を並べて `MUST_FIX_MAX=3` 件に絞る。designはround 1で全8基準が不合格、round 8でも全8基準が不合格だった。

`loop_state` では全 `last_scores` を取得できるので、全不足がサーバに存在しないわけではない。ただし担当への通常返却・親への報告がmust_fixだけに寄ると、一部だけ修正して残件を後回しにする構造になり得る。どれだけのroundをこれが増やしたかは未測定。

### 5. クライアント間の採点指示は同一ではない

現在のidle-talkとMCP開発元双方で確認:

| 項目 | Claude側sg-verifier | Codex側sg-verifier |
|---|---|---|
| 宣言model | sonnet | gpt-5.6-terra / medium |
| idle-talkの文字数 | 6,598 | 3,657 |
| 開発元の文字数 | 6,659 | 3,704 |
| Counterexample / design-check の記載 | あり | なし |
| Command evidence budget / scores[] の記載 | あり | なし |

設定ファイルの静的比較であり、この実行をどのクライアント・modelがどのround担当したかの証明ではない。指示の量、検証作業量、モデル固有の採点傾向の寄与は分離できていない。Codexの指示を短いままにすれば品質が同等だ、という結論にもならない。

### 6. 初回強制不合格は今回の主要因とは確認できない

policyは `min_rounds=2` と初回不合格最低数を持つ。しかし保存採点の初回点数はdesign 3〜6、plan 7〜8、implement 5〜8で、`enforced_iteration` は35採点記録すべてfalse。今回の37roundを初回強制だけでは説明できない。

補足: `first_round_ceiling=8` はpolicy/default/schemaに存在するが、現行server/srcでの全一致検索では採点を8へ制限する実行箇所は見つからなかった。「サーバが初回点数を8へ強制補正する」とは確認できない。合議へ渡した承認済み本文の「初回ceiling8」は設定値の意味として読み、実装強制との区別はこの調査記録を優先する。

### 7. 終盤の小さな進捗も平均点ベースの停滞判定に入る

planの平均点はround 4が8.736842、round 5も8.736842、round 6は8.894737。それでもround 6は `STALLED/no_improvement` になった。保存policyは `stall_window=2`、`stall_epsilon=0.25`。現行 `judge/stall.js` は改善幅がepsilon未満なら停滞カウンタを進めるため、0点改善と約0.1579点改善が2回連続の「停滞」として扱われる。

点が上がっただけで実質的な欠陥解消を証明するわけではないが、残issueの解消数・重大度などを見ず、平均点の固定幅だけで終盤の進捗を扱う点は検討対象になる。この点は合議開始後の追加照合で確認したため、参加者へ送った本文には含めていない。

## 合議で評価する論点

以下は結論ではなく、AI-Gougiへ諮る候補と検証課題。

1. 初回に全基準の不足を一覧化し、優先3件と未処理全件を別に保持できるか。
2. 固定issue ID、違反anchor、重大度、閉鎖条件、再オープン理由を使い、新しい要求の追加と本当の退行を区別できるか。
3. 9点の合格条件と10点までの改善提案を分け、9点でも残る弱点を非blockingとして記録できるか。
4. 成果物・上流digest・rubric・承認済みscope・検証証拠を束ね、成果物不変の正当な再評価を監査可能にできるか。
5. 通過基準を再利用する場合、変更依存による無効化と最後の全体整合確認をどう組み合わせるか。
6. 両クライアントへ同一の合格契約・根拠要件を配布し、作業負荷だけを減らせるか。
7. 追加roundより先にスコープ不一致・上流不足を検出できるか。初回強制や閾値変更はどの条件なら検討に値するか。

## 評価に必要な条件

- 探索用のidle-talk1例だけで削減率やモデル差を断定しない。
- 同じ入力/環境/テスト集合/モデル条件を固定した複数実行と、未使用の別課題で比較する。
- roundカウンタ・成功採点・拒否再送・kickback・承認待ち・実処理時間・入出力tokenを分離する。
- 既知欠陥と仕込んだ退行の見逃し、scopeの不正縮小、テストの除外/弱体化も測る。
- 過去成果物の再採点で分かるのは採点の差まで。修正経路が変わるため、実際に何round短縮したかは将来の対照実行で検証する。

## 参照した一次ファイル

- `D:/vagrant/idle-talk/.strict-goal/index.json`
- 上記3sessionの `session.json`、`rubric/1.json`、`rounds/*.json`、`rounds/*.rejected/*.json`、`escalations/*.json`
- `D:/vagrant/harnesses/rubric-loop-mcp/strict-goal/server/src/judge/engine.js`
- `D:/vagrant/harnesses/rubric-loop-mcp/strict-goal/server/src/judge/anti_gaming.js`
- `D:/vagrant/harnesses/rubric-loop-mcp/strict-goal/server/src/tools/score_submit.js`
- `D:/vagrant/harnesses/rubric-loop-mcp/strict-goal/server/src/tools/loop_state.js`
- `D:/vagrant/harnesses/rubric-loop-mcp/strict-goal/server/src/config/defaults.js`
- idle-talkとMCP開発元の `.claude/agents/sg-verifier.md`、`.codex/agents/sg-verifier.toml`

現行開発元ソースと当時の実行serverのバイナリ同一性は未検証。保存policy/rubricを当時の契約の根拠とし、現行ソースは現在の動作説明として区別する。

## 合議後の追加照合

参加者の指摘を受けて `chain/rebase.js` と実装sessionの `rebases/*.json` を確認した。現行rebaseには、上流引用が新しい上流文書に存在しなくなった基準を無効化する処理が既にある。「上流変更への対応が皆無」という説明は不正確。

本事例の2回のrebaseは、どちらも `invalidated=[]`、全9基準 `carried_over`。引用文字列が残っているかだけでは、周囲の契約や承認scopeの意味変更を捉えられない可能性がある。再評価経路は、この既存機能との整合を含めて設計する必要がある。

## 合議状態

承認前の送信は自動承認審査で拒否された。ユーザーが送信内容を確認して明示承認したため、同じ本文で2round合議を実施した。結果はpartial、Claude/Codexは両round成功、agyはR1 EMPTY_OUTPUTでR2に参加していない。所要605,657ms。合議全文と優先案は `docs/gougi/2026-10-16-strict-goal-round-reduction.md` に記録。


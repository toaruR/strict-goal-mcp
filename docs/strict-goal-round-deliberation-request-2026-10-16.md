# strict-goal round削減: 合議送信内容の確認

作成日: 2026-10-16 JST

状態: AI-Gougi deliberate(rounds=2) の送信が自動承認審査で拒否されたため、合議結果は未取得。再送していない。

送信先: 接続済み AI-Gougi MCP の Claude・Codex・agy 参加者。各参加者の背後にあるサービス・転送先は今回検証していない。

含む情報: ローカルプロジェクトのパス、strict-goal内部実装の要約、idle-talkのround・採点・検証履歴の抜粋、エージェント設定の比較。トークンや認証情報は含めていない。

以下がレビュー用の送信予定本文（1307文字）。明示承認が得られるまで再送しない。

```text
strict-goal MCPのround/時間/token削減を検討。実装はせず、以下の現在ソースと指定事例だけで原因と優先案を反論込みで評価。過去の古い実行例は使わない。
対象D:/vagrant/harnesses/rubric-loop-mcp と D:/vagrant/idle-talk/.strict-goal。user観測「Claude Codeが特に多く、次にCodex」。クライアント別の統制比較/token実測は未取得。
実測:idle-talk index/session roundはdesign13/plan11/implement13(計37)。読めるround JSONは13/11/11=35件、実装3と10は欠落。plan r7 FINAL後、implementから2回kickbackしてplan r9/r11もFINAL。design全8基準がr1不合格、r8も全8基準が7-8点。implement r8/r9同一digest、tests_green8(305pytest+node全greenだがlive29除外)、r11は「in-scope欠陥なし、同一digestで上げられない」。最終r13もlive除外、手動README監査、計画後追いの弱点を残すが9点。計画/スコープ修正による正当な再判定と水増しを区別できていない疑い。
ルーブリック9点anchor:tests_green=failed0/exit0/skipped非増、no_unplanned_change=計画paths内又はchange_note、docs_updated=実物との不一致なし(機械検査必須ではない)。途中「READMEが機械検査されない」「計画修正が事後的」等で8点が続く。
現行サーバはLLM採点を受け全基準>=9 AND加重平均>=9で判定、must_fixは低得点順等の上位3件だけ。score上昇時同一artifact拒否(E_SCORE_INFLATION)、同一evidence拒否(E_EVIDENCE_STALE)、+3超は成功command2件。min_rounds2、初回ceiling8+不合格最低1強制(事例では初回強制不合格ではなく実際低得点)。弱点noneは10点のみ。
現行/idle-talk双方のsg-verifier:Claude Sonnet版6598字/6659字、反例3probe+design-check+全基準根拠指定あり。Codex gpt-5.6-terra medium版3657/3704字、これら記述なし。差は確認したが因果未証明。
問:品質を落とさず何から変えるか。全不合格台帳/固定issue IDと重大度/9点anchorへの判定拘束/上流digest・scope・rubric・証拠変更を考慮した再評価/通過基準の依存無効化付き再利用/初回強制失敗見直し/クライアント指示統一を比較。局所対策の落とし穴と濫用防止、少数事例でのA/B評価指標(roundだけでなく欠陥見逃し/token/壁時計/承認待ち分離)も提案。
```

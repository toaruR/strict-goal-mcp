# strict-goal round-reduction plan: round 2 validation

対象計画は `strict-goal-round-reduction-plan.json`。上流は凍結済み artifact
`.strict-goal/sessions/rl_01M52N8D8CJW50XQW9PM1WZ9ZQ/artifacts/sha256-7834436c8df49b67f9b4995d0ea9f9103cb2a8096ee9a3ccdd13762a791ba338.md`
（SHA-256 はファイル本文の raw bytes）である。作業コピーの設計書には末尾 LF が一つ多いが、本文・見出しの根拠には凍結 artifact を使う。

## 計画上の完全性

全32見出しは JSON の `tasks[].design_refs` に存在する。§1、§2 と文書題名は T001 の baseline/境界化へ、§3〜§8 は T002〜T008 の契約・台帳・提出・再利用へ、§9〜§10 は T009〜T010 の互換性と品質ゲートへ、§11〜§13 は T004/T006/T013 の境界・受入・rollout へ対応する。

依存は `T001 → T002 → T003 → (T004, T006) → (T005, T007) → T008 → T009 → (T010, T011) → T012 → T013` である。分岐先も最終的に T013 に合流するため孤立タスクはない。T001 が不確実な実行元と比較基準を先に固定し、後続は失敗時に依存先を開始しない。

各タスクは JSON の `changes` で最大3ファイル、`estimate_rounds` で最大3周、`acceptance` で観測可能な境界、`verify` で cwd と終了コード0を指定する。これらは将来実装時の受入条件であり、未作成の将来テストをこの計画の現時点の実行結果としては扱わない。失敗時は当該タスクだけを戻し、先行タスクの green checkpoint と append-only record は残す。

## 実施済み機械検査

以下はいずれも終了コード0。

```powershell
cd ..\strict-goal\server
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {validatePlanSchema} from './src/artifact/plan_schema.js'; const p=JSON.parse(readFileSync('../../docs/plans/strict-goal-round-reduction-plan.json','utf8')); validatePlanSchema(p); console.log('plan-schema=ok tasks='+p.tasks.length+' changes='+p.tasks.flatMap(t=>t.changes).length);"
node --test test/plan_schema.test.js test/plan_checks.test.js
```

最初のコマンドは `plan-schema=ok tasks=13 changes=39` を出力する。2番目は schema と DAG guard の18件を通す。別途、凍結 artifact の見出し集合との比較、phantom dependency/循環/孤立、全 verify の command と `expect_exit_code`、全 `changes.kind` の enum を JSON 構造として検査する。

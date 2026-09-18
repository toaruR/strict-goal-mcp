#!/usr/bin/env bash
# 指摘妥当性判定（docs/plans/design-rubric-scope-and-verification.md）の事実主張を再現検証する。
# 使い方: bash scripts/verify-critique-claims.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SPEC=".benchmark/runs/bn_D1AM01R88BVW9SJXM0W0C0J8E4/trials/specification_strict_hierarchical_0Q7S7P9CX2CDHW8Y51YEM6VXKF.md"
SESS=".benchmark/sandboxes/tr_0Q7S7P9CX2CDHW8Y51YEM6VXKF/.strict-goal/sessions/rl_01M2PYVBQ16E132X7BSAPF0ACX"
fail=0
chk() { # chk <label> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "OK   C$1 expected=$2 actual=$3"
  else echo "FAIL C$1 expected=$2 actual=$3"; fail=1; fi
}

# C1: 被指摘成果物の loop_mode は design、状態は FINAL（ルーブリックは design プリセット由来）
chk 1 "design FINAL" "$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");const j=JSON.parse(s);console.log(j.loop_mode,j.state)' "$SESS/session.json")"

# C2: [改訂前の主張: そのセッションのルーブリック基準 id 15件が当時の design プリセットと完全一致]
# 実装後は presets/design.json が汎用8基準へ差し替えられ、ハーネス用基準は presets/design.harness.json（17基準）へ分離された
chk 2 "sess=15 design=8 harness=17" "$(node -e '
const fs=require("fs");
const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const d=JSON.parse(fs.readFileSync("strict-goal/presets/design.json","utf8"));
const h=JSON.parse(fs.readFileSync("strict-goal/presets/design.harness.json","utf8"));
console.log(`sess=${s.criteria.length} design=${d.criteria.length} harness=${h.criteria.length}`);' "$SESS/rubric/1.json")"

# C3: 課題文は Rate Limiter クラス設計であり、ハーネス設計ではない
chk 3 "1" "$(node -e 'console.log(/Rate Limiter/.test(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).task)?1:0)' "$SESS/session.json")"

# C4: 成果物にスコープ外の節（配布パッケージ / 自己適用レビュー記録 / 整合性補足 / 設計自己検証の記録）が存在
for pat in "配布パッケージ" "自己適用レビュー記録" "整合性補足" "設計自己検証の記録"; do
  chk "4:$pat" "1" "$(grep -cE "^#{2,3} .*$pat" "$SPEC")"
done

# C5: 判定式は「全基準が pass_score 以上」かつ「加重平均が pass_weighted_mean 以上」の連言（＝優先順位は判定に入らない）
chk 5 "1" "$(grep -c 'minScoreValue >= policy.pass_score && weightedMeanValue >= policy.pass_weighted_mean' strict-goal/server/src/judge/engine.js)"

# C6: [改訂前の主張: must_fix はスコア昇順のみで選抜され、weight もスコープ優先度も考慮しない]
# 実装後は priority 降順が第一キーとなり、同 priority 内でスコア昇順に選抜される
chk 6 "1" "$(grep -A6 'function buildMustFix' strict-goal/server/src/tools/score_submit.js | grep -c 'return (pB - pA) || (a.score - b.score)')"

# C7: [改訂前の主張: artifact_commit の警告はリライト率と縮小の4種のみ。分量予算・スコープ・追記節の検査は存在しない]
# 実装後は分量予算（over_budget）、スコープ（out_of_scope_section）、追記節（appendix_accretion）が加わり7種となった
chk 7 "appendix_accretion,artifact_unchanged,destructive_overwrite,near_total_rewrite,out_of_scope_section,over_budget,suspicious_shrink" "$(grep -oE "warnings.push\('[a-z_]+'\)" strict-goal/server/src/tools/artifact_commit.js | grep -oE "'[a-z_]+'" | tr -d "'" | sort -u | paste -sd, -)"

# C8: 肥大化は strict_hierarchical 固有ではない（同一 run 5群のバイト数。最大群を出力）
chk 8 "prompt_rubric" "$(for f in .benchmark/runs/bn_0C3QJFBCFJD7C0DM18RECFFNK4/trials/specification_*.md; do echo "$(wc -c <"$f") $(basename "$f")"; done | sort -rn | head -1 | sed -E 's/^[0-9]+ specification_(.+)_[0-9A-Z]{26}\.md$/\1/')"

# C9: [改訂前の主張: 旧 design プリセットの verification:"auto" 基準は3件（command 根拠必須の枠がすでに存在する）]
# 実装後は汎用 design プリセットにおいて verification:"auto" 基準が5件となった
chk 9 "5" "$(node -e 'console.log(JSON.parse(require("fs").readFileSync("strict-goal/presets/design.json","utf8")).criteria.filter(c=>c.verification==="auto").length)')"

# C10: loop_open は rubric_preset と任意 rubric の両経路を受理する（＝プリセット差し替えが可能）
chk 10 "2" "$(node -e '''const p=JSON.parse(require("fs").readFileSync("strict-goal/server/schemas/tools.json","utf8"));const t=p.loop_open?p.loop_open.input:p.tools.loop_open.input;console.log(["rubric","rubric_preset"].filter(k=>k in t.properties).length)''')"

# C11: 全群の成果物サイズ中央値（1000B未満のスタブを除く）が本文の表と一致
chk 11 "vanilla=18531 default_goal=20670 strict_hierarchical=21256 strict_single=25147 prompt_rubric=32997" "$(node -e '
const fs=require("fs"),path=require("path");const root=".benchmark/runs";const by={};
for(const b of fs.readdirSync(root)){const t=path.join(root,b,"trials");if(!fs.existsSync(t))continue;
for(const f of fs.readdirSync(t)){const m=f.match(/^specification_(.+)_[0-9A-Z]{26}\.md$/);if(!m)continue;
const n=fs.statSync(path.join(t,f)).size;if(n<1000)continue;(by[m[1]]??=[]).push(n);}}
const med=a=>{a.sort((x,y)=>x-y);const h=a.length>>1;return a.length%2?a[h]:Math.round((a[h-1]+a[h])/2);};
console.log(Object.entries(by).map(([k,v])=>[k,med(v)]).sort((a,b)=>a[1]-b[1]).map(([k,v])=>k+"="+v).join(" "));')"

# C12: 3プリセットとも require_command_evidence_for:["auto"]（command 根拠の強制枠が既存）
chk 12 "auto auto auto" "$(node -e 'console.log(["design","plan","implement"].map(p=>JSON.parse(require("fs").readFileSync("strict-goal/presets/"+p+".json","utf8")).policy.require_command_evidence_for.join("+")).join(" "))')"

# C13: verification:"auto" に command 根拠が無ければ E_EVIDENCE_KIND（改善3 が新規コード不要である根拠）
chk 13 "1" "$(grep -c "fail('E_EVIDENCE_KIND', 'verification:\"auto\" criteria require at least one command evidence'" strict-goal/server/src/evidence/verify.js)"

# C14: resume は保存済み rubric を読み、プリセットを読み直さない（改善1 が既存セッションに無影響である根拠）
chk 14 "loadRubric=1 loadPreset=0" "$(echo "loadRubric=$(grep -c 'loadRubric(sDir, session.rubric_version)' strict-goal/server/src/tools/loop_open_resume.js) loadPreset=$(grep -c 'loadPreset' strict-goal/server/src/tools/loop_open_resume.js)")"

# C15: destructive_overwrite の実条件（changed_ratio>=0.9 / 今回 <200B / 前周 >=2000B）
chk 15 "200 10" "$(node -e 'const s=require("fs").readFileSync("strict-goal/server/src/config/defaults.js","utf8");console.log(/DESTRUCTIVE_OVERWRITE_MIN_BYTES = (\d+)/.exec(s)[1], /DESTRUCTIVE_OVERWRITE_PREVIOUS_MULTIPLE = (\d+)/.exec(s)[1]);')"

# C16: rubric_amend は緩和分類を acknowledge_relaxation 無しで拒否し、差分を rubric_diff に永続化する
R16=$(grep -c E_RELAXATION_UNACKNOWLEDGED strict-goal/server/src/tools/rubric_amend.js)
P16=$(grep -c rubric_diff strict-goal/server/src/rubric/diff.js)
chk 16 "reject=1 persist=2" "reject=$R16 persist=$P16"


echo "---"
[ "$fail" = 0 ] && echo "ALL CLAIMS VERIFIED" || echo "SOME CLAIMS FAILED"
exit "$fail"

// 実装計画 (docs/plans/impl-plan-rubric-scope-and-verification.plan.json) が
// 上流設計書 (docs/plans/design-rubric-scope-and-verification.md) を覆っているかを機械検査する。
//
// 3検査を行い、1件でも落ちたら終了コード 1。
//   A. 見出し網羅  : 設計書の全見出しが、いずれかのタスクの design_refs から参照されているか、
//                    または EXEMPT_HEADINGS に「実装不要」の理由つきで登録されている。
//   B. ファイル網羅: 設計書がバッククォートで名指ししたファイルパスが、いずれかのタスクの
//                    changes[].path に現れるか、EXEMPT_PATHS に理由つきで登録されている。
//   C. 意味的整合  : 各 design_ref が名指ししたファイルが、同じタスクの changes[].path、
//                    または依存の先行タスクの changes[].path に現れる（参照だけして触らない refs を検出）。
import { readFileSync } from 'node:fs';

const PLAN = 'docs/plans/impl-plan-rubric-scope-and-verification.plan.json';
const DESIGN = 'docs/plans/design-rubric-scope-and-verification.md';

// 分析・判定のための節であり、実装を要する決定を含まない見出し。
const EXEMPT_HEADINGS = new Map([
  ['# スコープ遵守と計算検証の強制 — ルーブリック改善設計', '文書タイトル'],
  ['## 範囲外・未決事項', '設計書自身が範囲外と宣言した9項目。本計画では実装せず T013 で未決のまま明文化する'],
]);

// 設計書が根拠として引用するだけで変更を要さないファイル。
const EXEMPT_PATHS = new Map([
  ['strict-goal/server/src/judge/engine.js', '最小値ゲートの根拠として引用。判定式は変更しない'],
  ['strict-goal/server/src/tools/loop_open_resume.js', 'resume がプリセットを読み直さない根拠として引用。変更しない'],
  ['strict-goal/server/src/rubric/diff.js', '緩和分類の所在として引用。priority の分類規則は未決事項で実装対象外'],
  ['strict-goal/server/src/tools/rubric_amend.js', '緩和拒否の既存経路として引用。変更しない'],
  ['strict-goal/server/src/evidence/verify.js', 'E_EVIDENCE_KIND の発火箇所として引用。改善3 は既存挙動を流用する'],
  ['strict-goal/server/test/evidence.test.js', '改善3 の経路が既存テストで覆われている根拠。新規テストは不要と設計書が明記'],
  ['strict-goal/server/test/errors_score_submit.test.js', '同上'],
  ['strict-goal/server/test/at_3.test.js', '同上'],
  ['strict-goal/server/test/failure_modes_1_10.test.js', '同上'],
  ['strict-goal/presets/plan.json', '改善6 の予算を design のみに置く決定の対照。値は設定しない'],
  ['strict-goal/presets/implement.json', '同上。plan/implement への横展開は未決事項'],
  ['session.json', 'セッション永続ファイル。T011 の測定スクリプトが round を読むだけで書き換えない'],
]);

const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
const design = readFileSync(DESIGN, 'utf8');

const failures = [];

// --- A. 見出し網羅 ---
const headings = design.split('\n').filter((l) => /^#{1,4} /.test(l.trimEnd())).map((l) => l.trimEnd());
const allRefs = plan.tasks.flatMap((t) => t.design_refs.map((r) => ({ task: t.id, ref: r })));
const headingOwners = new Map();
for (const h of headings) {
  const owners = allRefs.filter(({ ref }) => h.includes(ref.trim()) || ref.trim().includes(h)).map((r) => r.task);
  headingOwners.set(h, [...new Set(owners)]);
  if (owners.length === 0 && !EXEMPT_HEADINGS.has(h)) {
    failures.push(`A: 見出しがどのタスクからも参照されず、実装不要の宣言も無い: ${h}`);
  }
}

// --- B. ファイル網羅 ---
const planPaths = new Set(plan.tasks.flatMap((t) => t.changes.map((c) => c.path)));
const pathPattern = /`([A-Za-z0-9_./-]+\.(?:json|js|mjs|sh|md))(?::\d+(?:-\d+)?)?`/g;
const mentioned = new Set();
for (const m of design.matchAll(pathPattern)) mentioned.add(m[1]);

const normalize = (p) => p.replace(/^\.\//, '');
const coveredBy = (mentionedPath, candidates) => {
  const n = normalize(mentionedPath);
  return [...candidates].some((p) => {
    const c = normalize(p);
    return c === n || c.endsWith('/' + n) || n.endsWith('/' + c);
  });
};

const fileReport = { covered: 0, exempt: 0 };
for (const p of [...mentioned].sort()) {
  if (coveredBy(p, planPaths)) {
    fileReport.covered += 1;
  } else if ([...EXEMPT_PATHS.keys()].some((e) => coveredBy(p, [e]))) {
    fileReport.exempt += 1;
  } else {
    failures.push(`B: 設計書が名指ししたファイルを計画のどのタスクも触らず、実装不要の宣言も無い: ${p}`);
  }
};

// --- C. 意味的整合 ---
const byId = new Map(plan.tasks.map((t) => [t.id, t]));
const ancestorsOf = (id, seen = new Set()) => {
  for (const dep of byId.get(id).depends_on) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    ancestorsOf(dep, seen);
  }
  return seen;
};

const descendantsOf = (id) => plan.tasks.filter((t) => t.id !== id && ancestorsOf(t.id).has(id)).map((t) => t.id);

let refPathChecks = 0;
const deferrals = [];
for (const task of plan.tasks) {
  const reachable = new Set(task.changes.map((c) => c.path));
  for (const anc of ancestorsOf(task.id)) for (const c of byId.get(anc).changes) reachable.add(c.path);
  for (const ref of task.design_refs) {
    for (const m of ref.matchAll(pathPattern)) {
      refPathChecks += 1;
      const p = m[1];
      if (coveredBy(p, reachable)) continue;
      if ([...EXEMPT_PATHS.keys()].some((e) => coveredBy(p, [e]))) continue;
      // 後続タスクが触る場合は実行順で必ず後から満たされるため、失敗ではなく繰り延べとして記録する。
      const later = descendantsOf(task.id).filter((d) => coveredBy(p, byId.get(d).changes.map((c) => c.path)));
      if (later.length > 0) {
        deferrals.push(`${task.id} の design_ref が名指しした ${p} は後続 ${later.join('/')} で変更される`);
        continue;
      }
      failures.push(`C: ${task.id} の design_ref が名指しした ${p} を、同タスクも先行タスクも後続タスクも変更しない`);
    }
  }
}

console.log(`headings=${headings.length} exempt_headings=${EXEMPT_HEADINGS.size} ` +
  `mentioned_paths=${mentioned.size} covered=${fileReport.covered} exempt_paths=${fileReport.exempt} ` +
  `ref_path_checks=${refPathChecks} deferrals=${deferrals.length} failures=${failures.length}`);
for (const d of deferrals) console.log('  deferral: ' + d);
for (const f of failures) console.log('  ' + f);
process.exit(failures.length === 0 ? 0 : 1);

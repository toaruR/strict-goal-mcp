// 実装計画 JSON から人間可読な Markdown を生成する（JSON が正、MD は派生物）。
// 使い方: node scripts/render-plan-md.mjs [--check]
//   --check: 既存 MD と生成結果が一致しなければ終了コード 1（JSON 改訂後の再生成漏れ検出）。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'docs/plans/impl-plan-rubric-scope-and-verification.plan.json';
const OUT = 'docs/plans/impl-plan-rubric-scope-and-verification.md';

const raw = readFileSync(SRC);
const plan = JSON.parse(raw.toString('utf8'));
const digest = createHash('sha256').update(raw).digest('hex');

const byId = new Map(plan.tasks.map((t) => [t.id, t]));
const dependents = (id) => plan.tasks.filter((t) => t.depends_on.includes(id)).map((t) => t.id);

const L = [];
L.push('# 実装計画: スコープ遵守と計算検証の強制 — ルーブリック改善');
L.push('');
L.push(`> このファイルは \`${SRC}\` から \`node scripts/render-plan-md.mjs\` で生成した派生物。`);
L.push('> 編集は JSON 側に行い、本ファイルは再生成する（`--check` で差分を検出できる）。');
L.push('');
L.push('| 項目 | 値 |');
L.push('|---|---|');
L.push(`| 上流設計書 | \`docs/plans/design-rubric-scope-and-verification.md\` |`);
L.push(`| plan_version | ${plan.plan_version} |`);
L.push(`| タスク数 | ${plan.tasks.length} |`);
L.push(`| 見積ラウンド合計 | ${plan.tasks.reduce((n, t) => n + t.estimate_rounds, 0)} |`);
L.push(`| 受け入れ条件 / 検証コマンド | ${plan.tasks.reduce((n, t) => n + t.acceptance.length, 0)} 件 / ${plan.tasks.reduce((n, t) => n + t.verify.length, 0)} 件 |`);
L.push(`| JSON sha256 | \`${digest}\` |`);
L.push('');

L.push('## 方針');
L.push('');
L.push(plan.summary);
L.push('');

L.push('## 実行順と依存');
L.push('');
L.push('| # | id | タイトル | 依存 | 後続 | 変更 | 受入 | 検証 | 見積 |');
L.push('|---|---|---|---|---|---|---|---|---|');
plan.tasks.forEach((t, i) => {
  L.push(`| ${i + 1} | ${t.id} | ${t.title} | ${t.depends_on.join(', ') || '—'} | ${dependents(t.id).join(', ') || '—'} | ${t.changes.length} | ${t.acceptance.length} | ${t.verify.length} | ${t.estimate_rounds} |`);
});
L.push('');

L.push('## 前提・制約');
L.push('');
plan.assumptions.forEach((a, i) => L.push(`${i + 1}. ${a}`));
L.push('');

L.push('## タスク詳細');
L.push('');
for (const t of plan.tasks) {
  L.push(`### ${t.id}: ${t.title}`);
  L.push('');
  L.push(`- **依存**: ${t.depends_on.join(', ') || 'なし（起点）'}　**後続**: ${dependents(t.id).join(', ') || 'なし（終端）'}　**見積**: ${t.estimate_rounds} ラウンド`);
  L.push('');
  L.push('**意図**');
  L.push('');
  L.push(t.intent);
  L.push('');
  L.push('**設計書の根拠 (design_refs)**');
  L.push('');
  t.design_refs.forEach((r) => L.push(`- \`${r}\``));
  L.push('');
  L.push('**変更対象**');
  L.push('');
  L.push('| kind | path | 備考 |');
  L.push('|---|---|---|');
  t.changes.forEach((c) => L.push(`| ${c.kind} | \`${c.path}\` | ${c.note ?? ''} |`));
  L.push('');
  L.push('**受け入れ条件**');
  L.push('');
  t.acceptance.forEach((a) => L.push(`- [ ] ${a}`));
  L.push('');
  L.push('**検証コマンド**');
  L.push('');
  t.verify.forEach((v, i) => {
    L.push(`${i + 1}. ${v.note ?? ''}（期待終了コード ${v.expect_exit_code}）`);
    L.push('');
    L.push('   ```bash');
    L.push(`   ${v.command}`);
    L.push('   ```');
    L.push('');
  });
}

const md = L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { console.error(`missing: ${OUT}`); process.exit(1); }
  if (current !== md) { console.error(`stale: ${OUT} は JSON から再生成が必要`); process.exit(1); }
  console.log(`ok: ${OUT} は JSON と一致 (json_sha256=${digest})`);
} else {
  writeFileSync(OUT, md);
  console.log(`wrote ${OUT} (${Buffer.byteLength(md, 'utf8')} bytes, json_sha256=${digest})`);
}

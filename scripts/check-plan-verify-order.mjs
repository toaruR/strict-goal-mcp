// 実装計画の各タスクの検証コマンドが、そのタスクと先行タスクだけを適用した「中間状態」で
// 実行可能かを機械検査する。1件でも落ちたら終了コード 1。
//
// 検査内容: verify[].command 内で名指しされたファイルパスが、その時点で
//   (a) リポジトリに既存、または (b) 当該タスクか先行タスクが kind:"add" で作る
// のいずれかを満たすこと。後続タスクが作るファイルを先に参照していたら失敗させる。
// パスは `cd <dir> &&` を解釈した上で、そのコマンドの実効カレントディレクトリ基準で解決する。
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PLAN = 'docs/plans/impl-plan-rubric-scope-and-verification.plan.json';
const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
const byId = new Map(plan.tasks.map((t) => [t.id, t]));

const ancestorsOf = (id, seen = new Set()) => {
  for (const dep of byId.get(id).depends_on) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    ancestorsOf(dep, seen);
  }
  return seen;
};

// コマンド文字列に現れる拡張子つきパス。require("fs") のような拡張子なし識別子は拾わない。
const PATH_RE = /([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:json|js|mjs|sh|md))/g;
const CD_RE = /^\s*cd\s+([A-Za-z0-9_./-]+)\s*&&/;

const failures = [];
let checks = 0;

for (const task of plan.tasks) {
  const created = new Set();
  for (const id of [task.id, ...ancestorsOf(task.id)]) {
    for (const c of byId.get(id).changes) if (c.kind === 'add') created.add(c.path);
  }
  for (const v of task.verify) {
    const cwd = CD_RE.exec(v.command)?.[1] ?? '.';
    for (const m of v.command.matchAll(PATH_RE)) {
      const raw = m[1];
      const resolved = path.posix.normalize(path.posix.join(cwd, raw.replace(/^\.\//, '')));
      checks += 1;
      if (existsSync(resolved)) continue;
      if ([...created].some((c) => c === resolved || resolved.endsWith('/' + c) || c.endsWith('/' + resolved))) continue;
      const later = plan.tasks.filter((t) => t.changes.some((c) => c.kind === 'add' && (c.path === resolved || resolved.endsWith('/' + c.path))));
      if (later.length > 0) {
        failures.push(`${task.id} の検証コマンドが ${resolved} を参照するが、生成するのは後続 ${later.map((t) => t.id).join('/')} であり中間状態では存在しない`);
      } else {
        failures.push(`${task.id} の検証コマンドが ${resolved} を参照するが、既存ファイルでもどのタスクの追加対象でもない（cwd=${cwd}, 記述=${raw}）`);
      }
    }
  }
}

console.log(`tasks=${plan.tasks.length} path_checks=${checks} failures=${failures.length}`);
for (const f of failures) console.log('  ' + f);
process.exit(failures.length === 0 ? 0 : 1);

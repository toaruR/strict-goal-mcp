// T074: 可搬性とスコープ外の混入がないことを検査する（設計書 1.2/1.3, 9.1, 11.2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..', '..');

function readJsonRaw(relPath) {
  return readFileSync(path.join(packageRoot, relPath), 'utf8');
}
function readJson(relPath) {
  return JSON.parse(readJsonRaw(relPath));
}

// 9.1: 直下のコンポーネントは skills/ と mcp.json の2種のみ（mcp.http.json は固定位置ではないため発見されない）。
test('パッケージ直下のコンポーネントが skills/ と mcp.json の2種だけである', () => {
  assert.ok(existsSync(path.join(packageRoot, 'skills')), 'skills/ が必要');
  assert.ok(statSync(path.join(packageRoot, 'skills')).isDirectory());
  assert.ok(existsSync(path.join(packageRoot, 'mcp.json')), 'mcp.json が必要');
  assert.ok(statSync(path.join(packageRoot, 'mcp.json')).isFile());

  const entries = readdirSync(packageRoot);
  const nonComponentEntries = new Set(['plugin.json', 'mcp.http.json', 'presets', 'server']);
  const unexpected = entries.filter((e) => e !== 'skills' && e !== 'mcp.json' && !nonComponentEntries.has(e));
  assert.deepEqual(unexpected, [], `未知のトップレベル項目: ${unexpected.join(', ')}`);
});

function extractVariables(text) {
  const matches = [...text.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
  return new Set(matches);
}

// 1.1/1.2 A2: mcp.json / mcp.http.json で展開してよい変数は PLUGIN_ROOT と PLUGIN_DATA のみ。
test('mcp.json と mcp.http.json で展開される変数が PLUGIN_ROOT と PLUGIN_DATA の2種のみ', () => {
  const mcpVars = extractVariables(readJsonRaw('mcp.json'));
  assert.deepEqual([...mcpVars].sort(), ['PLUGIN_DATA', 'PLUGIN_ROOT']);

  const mcpHttpVars = extractVariables(readJsonRaw('mcp.http.json'));
  assert.deepEqual([...mcpHttpVars], []);
});

// 11.2: ${CLAUDE_PLUGIN_ROOT} 等のベンダー別名は mcp.json/mcp.http.json に書かない。
test('mcp.json / mcp.http.json にベンダー固有の変数名が現れない', () => {
  assert.ok(!readJsonRaw('mcp.json').includes('CLAUDE_PLUGIN'));
  assert.ok(!readJsonRaw('mcp.http.json').includes('CLAUDE_PLUGIN'));
});

function collectJsonFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules') continue;
      collectJsonFiles(full, acc);
    } else if (entry.endsWith('.json')) {
      acc.push(full);
    }
  }
  return acc;
}

// 9.2: plugin.json に資格情報キーを置かない。固定位置の配布ファイル(plugin.json/mcp.json/mcp.http.json)も同様。
test('固定位置の配布ファイルに資格情報を名に持つキーが1件も無い', () => {
  const credentialPattern = /token|key|secret|password/i;
  for (const rel of ['plugin.json', 'mcp.json', 'mcp.http.json']) {
    const obj = readJson(rel);
    const badKeys = Object.keys(JSON.parse(JSON.stringify(obj))).filter((k) => credentialPattern.test(k));
    assert.deepEqual(badKeys, [], `${rel} に資格情報キー`);
  }
});

// 9.3: cwd は PLUGIN_ROOT / PLUGIN_DATA 配下から出ない(`..` を含まない)。
test('mcp.json の cwd が PLUGIN_ROOT/PLUGIN_DATA 配下に閉じている', () => {
  const mcp = readJson('mcp.json');
  const cwd = mcp.mcpServers['rubric-loop'].cwd;
  assert.ok(cwd === '${PLUGIN_ROOT}' || cwd === '${PLUGIN_DATA}' || cwd.startsWith('${PLUGIN_ROOT}/') || cwd.startsWith('${PLUGIN_DATA}/'));
  assert.ok(!cwd.includes('..'));
});

// 1.3: 成果物のレンダリング・配布・CI 連携はスコープ外 → パッケージにCI設定/配布スクリプト/レンダリング関連ファイルを含めない。
test('CI設定ファイル・配布用スクリプト・レンダリング関連ファイルがパッケージに含まれない', () => {
  const forbiddenNames = /^(\.github|\.gitlab-ci\.yml|Dockerfile|\.dockerignore|Makefile)$/i;
  const forbiddenExt = /\.(ya?ml)$/i;
  const stack = [packageRoot];
  const offenders = [];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (forbiddenNames.test(entry) || (stat.isFile() && forbiddenExt.test(entry))) {
        offenders.push(path.relative(packageRoot, full));
      }
      if (stat.isDirectory()) stack.push(full);
    }
  }
  assert.deepEqual(offenders, []);
});

// 11.2: server/src 配下のコードは env 変数名をベタ書きせず、mcp.json の env キー経由でのみ受け取る。
test('server/src 配下に mcp.json が宣言しない env キー名（ベンダー固有名含む）がハードコードされていない', () => {
  const mcp = readJson('mcp.json');
  const declaredEnvKeys = Object.keys(mcp.mcpServers['rubric-loop'].env ?? {});
  assert.deepEqual(declaredEnvKeys.sort(), ['RUBRIC_LOOP_DATA', 'RUBRIC_LOOP_LOG', 'RUBRIC_LOOP_ROOT'].sort());

  const jsonFiles = collectJsonFiles(path.join(packageRoot, 'server', 'schemas'));
  for (const f of jsonFiles) {
    assert.ok(!readFileSync(f, 'utf8').includes('CLAUDE_PLUGIN'), f);
  }
});

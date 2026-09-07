import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const agentsDir = path.resolve(repoRoot, '.agents', 'agents');
const skillFile = path.resolve(repoRoot, 'strict-goal', 'skills', 'strict-goal', 'SKILL.md');

function parseFrontmatter(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, `Frontmatter not found in ${filePath}`);
  const lines = match[1].split('\n');
  const meta = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }
  }
  return { meta, body: content.slice(match[0].length) };
}

test('サブエージェント定義ファイルが存在し、正しいフロントマターを持つ', () => {
  const agents = ['coder', 'implementer', 'task-worker'];
  for (const name of agents) {
    const file = path.resolve(agentsDir, `${name}.md`);
    assert.ok(existsSync(file), `${name}.md does not exist at ${file}`);
    const { meta } = parseFrontmatter(file);
    assert.equal(meta.name, name);
    assert.ok(meta.description && meta.description.length > 10);
    assert.ok(meta.tools && meta.tools.length > 0);
  }
});

test('implementer は監督者として Subagent および strict-goal ツールを持ち、階層委譲手順を規定している', () => {
  const file = path.resolve(agentsDir, 'implementer.md');
  const { meta, body } = parseFrontmatter(file);
  assert.match(meta.tools, /Subagent/i);
  assert.match(meta.tools, /mcp__strict-goal__/);
  assert.match(body, /sequential|シーケンシャル/i);
  assert.match(body, /loop_open/);
  assert.match(body, /helper\.js/);
});

test('task-worker は孫作業員としてスコープ限定され、strict-goal ハーネス操作を禁止されている', () => {
  const file = path.resolve(agentsDir, 'task-worker.md');
  const { meta, body } = parseFrontmatter(file);
  assert.doesNotMatch(meta.tools, /strict-goal/);
  assert.match(body, /single[- ]task|単一タスク/i);
  assert.match(body, /strict-goal/i);
  assert.match(body, /prohibitions|やってはいけないこと/i);
});

test('SKILL.md にサブエージェント委譲および階層型タスク委譲セクションが存在する', () => {
  const content = readFileSync(skillFile, 'utf8');
  assert.match(content, /## Subagent Delegation for Implementation/);
  assert.match(content, /Hierarchical Task Delegation/);
  assert.match(content, /invoke_subagent/);
  assert.match(content, /task-worker/);
  assert.match(content, /helper\.js/);
});

test('サブエージェント関連の設計計画書が存在する', () => {
  const plan1 = path.resolve(repoRoot, 'docs', 'plans', 'subagent-implementation-plan.md');
  const plan2 = path.resolve(repoRoot, 'docs', 'plans', 'hierarchical-task-subagent-plan.md');
  assert.ok(existsSync(plan1), `${plan1} does not exist`);
  assert.ok(existsSync(plan2), `${plan2} does not exist`);
});

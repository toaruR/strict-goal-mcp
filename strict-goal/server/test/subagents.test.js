import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const agentsDirs = [
  path.resolve(repoRoot, '.agents', 'agents'),
  ...(existsSync(path.resolve(repoRoot, '.claude', 'agents')) ? [path.resolve(repoRoot, '.claude', 'agents')] : []),
];
const skillFiles = [
  path.resolve(repoRoot, 'strict-goal', 'skills', 'strict-goal', 'SKILL.md'),
  ...(existsSync(path.resolve(repoRoot, '.claude', 'skills', 'strict-goal', 'SKILL.md'))
    ? [path.resolve(repoRoot, '.claude', 'skills', 'strict-goal', 'SKILL.md')]
    : []),
];
const agentsMdFile = path.resolve(repoRoot, 'AGENTS.md');
const claudeMdFile = path.resolve(repoRoot, 'CLAUDE.md');

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

test('サブエージェント定義ファイルが存在し、正しいフロントマターを持つ (.agents & .claude)', () => {
  const sgAgents = ['sg-coder', 'sg-implementer', 'sg-worker', 'sg-scout', 'sg-verifier'];
  for (const dir of agentsDirs) {
    for (const name of sgAgents) {
      const file = path.resolve(dir, `${name}.md`);
      assert.ok(existsSync(file), `${name}.md does not exist at ${file}`);
      const { meta } = parseFrontmatter(file);
      assert.equal(meta.name, name);
      assert.ok(meta.description && meta.description.length > 10);
      assert.ok(meta.tools && meta.tools.length > 0);
    }
  }
});

test('sg-implementer は監督者として Subagent / Agent および strict-goal ツールを持ち、階層委譲手順を規定している', () => {
  for (const dir of agentsDirs) {
    const file = path.resolve(dir, 'sg-implementer.md');
    const { meta, body } = parseFrontmatter(file);
    assert.match(meta.tools, /(Subagent|Agent)/i);
    assert.match(meta.tools, /mcp__strict-goal__/);
    assert.match(body, /sequential|シーケンシャル/i);
    assert.match(body, /loop_open/);
    assert.match(body, /helper\.js/);
    assert.match(body, /sg-worker/);
  }
});

test('sg-worker は孫作業員としてスコープ限定され、strict-goal ハーネス操作を禁止されている', () => {
  for (const dir of agentsDirs) {
    const file = path.resolve(dir, 'sg-worker.md');
    const { meta, body } = parseFrontmatter(file);
    assert.doesNotMatch(meta.tools, /strict-goal/);
    assert.match(body, /single[- ]task|単一タスク/i);
    assert.match(body, /strict-goal/i);
    assert.match(body, /prohibitions|やってはいけないこと/i);
  }
});

test('sg-coder は自律単体実装者として strict-goal ツールを持ち、完遂手順を規定している', () => {
  for (const dir of agentsDirs) {
    const file = path.resolve(dir, 'sg-coder.md');
    const { meta, body } = parseFrontmatter(file);
    assert.match(meta.tools, /mcp__strict-goal__/);
    assert.match(body, /loop_open/);
    assert.match(body, /helper\.js/);
    assert.match(body, /FINAL/);
  }
});

test('SKILL.md にサブエージェント委譲および階層型タスク委譲セクションが存在する', () => {
  for (const file of skillFiles) {
    const content = readFileSync(file, 'utf8');
    assert.match(content, /## Subagent Delegation for Implementation/);
    assert.match(content, /Hierarchical Task Delegation/);
    assert.match(content, /sg-implementer/);
    assert.match(content, /sg-worker/);
    assert.match(content, /sg-coder/);
    assert.match(content, /helper\.js/);
  }
});

test('CLAUDE.md と AGENTS.md にそれぞれ適切な Agents / Subagents 記述が存在する', () => {
  assert.ok(existsSync(claudeMdFile), 'CLAUDE.md does not exist');
  const claudeContent = readFileSync(claudeMdFile, 'utf8');
  assert.match(claudeContent, /## Agents \/ Subagents/);
  assert.match(claudeContent, /\.claude\/agents\//);
  assert.match(claudeContent, /Agent\(subagent_type=/);
  assert.match(claudeContent, /sg-implementer/);
  assert.match(claudeContent, /sg-worker/);
  assert.match(claudeContent, /sg-coder/);

  assert.ok(existsSync(agentsMdFile), 'AGENTS.md does not exist');
  const agentsContent = readFileSync(agentsMdFile, 'utf8');
  assert.match(agentsContent, /## Agents \/ Subagents/);
  assert.match(agentsContent, /\.agents\/agents\//);
  assert.match(agentsContent, /sg-implementer/);
  assert.match(agentsContent, /sg-worker/);
  assert.match(agentsContent, /sg-coder/);
});

test('サブエージェント関連の設計計画書が存在する', () => {
  const plan1 = path.resolve(repoRoot, 'docs', 'plans', 'subagent-implementation-plan.md');
  const plan2 = path.resolve(repoRoot, 'docs', 'plans', 'hierarchical-task-subagent-plan.md');
  assert.ok(existsSync(plan1), `${plan1} does not exist`);
  assert.ok(existsSync(plan2), `${plan2} does not exist`);
});

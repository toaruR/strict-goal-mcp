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
const canonicalAgentsDir = path.resolve(repoRoot, 'strict-goal', 'agents');
// 正本 strict-goal/agents/ と配布コピーで内容一致が保証されているファイル。
// 乖離解消が未完了のものは意図的に含めない。
const syncedAgents = ['sg-worker', 'sg-verifier', 'sg-designer'];
const skillFiles = [
  path.resolve(repoRoot, 'strict-goal', 'skills', 'strict-goal', 'SKILL.md'),
  ...(existsSync(path.resolve(repoRoot, '.claude', 'skills', 'strict-goal', 'SKILL.md'))
    ? [path.resolve(repoRoot, '.claude', 'skills', 'strict-goal', 'SKILL.md')]
    : []),
];
const agentsMdFile = path.resolve(repoRoot, 'AGENTS.md');
const claudeMdFile = path.resolve(repoRoot, 'CLAUDE.md');

// CRLF→LF 変換と各行末尾の空白除去による正規化。配布コピーは CRLF、正本は LF のため。
function normalize(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}

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
  const sgAgents = ['sg-coder', 'sg-implementer', 'sg-worker', 'sg-scout', 'sg-verifier', 'sg-designer'];
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

test('sg-designer は設計監督者として Subagent / Agent および strict-goal ツールを持ち、設計反復手順を規定している', () => {
  for (const dir of agentsDirs) {
    const file = path.resolve(dir, 'sg-designer.md');
    const { meta, body } = parseFrontmatter(file);
    assert.match(meta.tools, /(Subagent|Agent)/i);
    assert.match(meta.tools, /mcp__strict-goal__/);
    assert.match(body, /loop_open/);
    assert.match(body, /helper\.js/);
    assert.match(body, /sg-verifier/);
    assert.match(body, /design-draft/);
    assert.match(body, /design-fix/);
    assert.match(body, /FINAL/);
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
    assert.match(content, /sg-designer/);
    assert.match(content, /sg-implementer/);
    assert.match(content, /sg-worker/);
    assert.match(content, /sg-coder/);
    assert.match(content, /helper\.js/);
  }
});

test('CLAUDE.md と AGENTS.md にそれぞれ適切な Agents / Subagents 記述が存在する', () => {
  assert.ok(existsSync(claudeMdFile), 'CLAUDE.md does not exist');
  const claudeContent = readFileSync(claudeMdFile, 'utf8');
  assert.match(claudeContent, /## (Strict-Goal & Subagents Protocol|Agents \/ Subagents)/);
  assert.match(claudeContent, /\.claude\/agents\//);
  assert.match(claudeContent, /Agent\(subagent_type=/);
  assert.match(claudeContent, /sg-designer/);
  assert.match(claudeContent, /sg-implementer/);
  assert.match(claudeContent, /sg-worker/);
  assert.match(claudeContent, /sg-coder/);

  assert.ok(existsSync(agentsMdFile), 'AGENTS.md does not exist');
  const agentsContent = readFileSync(agentsMdFile, 'utf8');
  assert.match(agentsContent, /## (Strict-Goal & Subagents Protocol|Agents \/ Subagents)/);
  assert.match(agentsContent, /\.agents\/agents\//);
  assert.match(agentsContent, /sg-designer/);
  assert.match(agentsContent, /sg-implementer/);
  assert.match(agentsContent, /sg-worker/);
  assert.match(agentsContent, /sg-coder/);
});

test('正本 strict-goal/agents/ のサブエージェント定義が存在し、正しいフロントマターを持つ', () => {
  for (const name of syncedAgents) {
    const file = path.resolve(canonicalAgentsDir, `${name}.md`);
    assert.ok(existsSync(file), `${name}.md does not exist at ${file}`);
    const { meta } = parseFrontmatter(file);
    assert.equal(meta.name, name);
    assert.ok(meta.description && meta.description.length > 10);
    assert.ok(meta.tools && meta.tools.length > 0);
  }
});

test('Markdown agent behavior remains synchronized across distributions', () => {
  const withoutKitVersion = file => normalize(file).replace(/knowledge-kit version=\d+\.\d+\.\d+[^\n]*/, 'knowledge-kit version');
  for (const name of syncedAgents) {
    const expected = withoutKitVersion(path.resolve(canonicalAgentsDir, name + '.md'));
    for (const dir of agentsDirs) {
      assert.equal(withoutKitVersion(path.resolve(dir, name + '.md')), expected);
    }
  }
});

test('maintained Markdown agents carry a knowledge-kit version', () => {
  for (const name of syncedAgents) {
    for (const dir of [canonicalAgentsDir, ...agentsDirs]) {
      assert.match(readFileSync(path.resolve(dir, name + '.md'), 'utf8'), /knowledge-kit version=\d+\.\d+\.\d+/);
    }
  }
});

test('sg-verifier.md (正本および配布コピー) に悪魔の代弁者3プローブと design-check が明記されている', () => {
  const verifierFiles = [
    path.resolve(canonicalAgentsDir, 'sg-verifier.md'),
    ...agentsDirs.map((dir) => path.resolve(dir, 'sg-verifier.md')),
  ];
  const probes = ['time_state_trace', 'policy_trace', 'complexity_trace'];
  for (const file of verifierFiles) {
    const content = readFileSync(file, 'utf8');
    for (const probe of probes) {
      assert.ok(content.includes(probe), `${file} に ${probe} が含まれていません`);
    }
    assert.ok(content.includes('design-check'), `${file} に design-check が含まれていません`);
  }
});

test('sg-worker.md (正本および配布コピー) に impact.json 生成手順と上限件数が明記されている', () => {
  const workerFiles = [
    path.resolve(canonicalAgentsDir, 'sg-worker.md'),
    ...agentsDirs.map((dir) => path.resolve(dir, 'sg-worker.md')),
  ];
  const keys = ['changed_contracts', 'affected_sections', 'checks', 'unresolved'];
  const limits = ['3', '5', '3', '2'];
  for (const file of workerFiles) {
    const content = readFileSync(file, 'utf8');
    for (let i = 0; i < keys.length; i++) {
      assert.ok(content.includes(keys[i]), `${file} に ${keys[i]} が含まれていません`);
      assert.ok(content.includes(limits[i]), `${file} に上限数値 ${limits[i]} が含まれていません`);
    }
    assert.ok(content.includes('.strict-goal/evidence/'), `${file} に .strict-goal/evidence/ が含まれていません`);
    assert.ok(content.includes('impact.json'), `${file} に impact.json が含まれていません`);
  }
});

test('sg-verifier.md (正本および配布コピー) に impact.json 読込・design-check検証手順が明記されている', () => {
  const verifierFiles = [
    path.resolve(canonicalAgentsDir, 'sg-verifier.md'),
    ...agentsDirs.map((dir) => path.resolve(dir, 'sg-verifier.md')),
  ];
  for (const file of verifierFiles) {
    const content = readFileSync(file, 'utf8');
    assert.ok(content.includes('impact.json'), `${file} に impact.json が含まれていません`);
    assert.ok(content.includes('読み込み') || content.includes('読込'), `${file} に 読み込み/読込 が含まれていません`);
    assert.ok(content.includes('存在しない場合') || content.includes('無い場合'), `${file} に 存在しない場合/無い場合 が含まれていません`);
    assert.ok(content.includes('design-check'), `${file} に design-check が含まれていません`);
  }
});

test('サブエージェント関連の設計計画書が存在する', () => {
  const plan1 = path.resolve(repoRoot, 'docs', 'plans', 'subagent-implementation-plan.md');
  const plan2 = path.resolve(repoRoot, 'docs', 'plans', 'hierarchical-task-subagent-plan.md');
  assert.ok(existsSync(plan1), `${plan1} does not exist`);
  assert.ok(existsSync(plan2), `${plan2} does not exist`);
});

// Each maintained agent copy must carry every behavioral step, independently.
const v2Procedures = [
  /Preserve the full issue ledger and evidence.*unresolved issue IDs.*ledger reference.*top three must_fix/,
  /bounded issue probe:.*anchor clause.*evidence locator and digest.*resolution condition.*score below 9.*score at least 9/,
  /bounded scope probe:.*scope digests.*affected criteria.*approval/,
  /bounded rubric probe:.*rubric digests.*affected criteria.*approval/,
  /bounded environment probe:.*environment digests.*affected criteria.*approval/,
  /bounded test-selection probe:.*selected and excluded tests.*affected criteria.*approval/,
  /bounded reuse probe:.*fresh from reused.*dependency values.*evidence locator and TTL.*environment digest.*evaluate fresh/,
  /Prepare structured score evidence for verifier submission.*criterion ID.*anchor status.*issue IDs.*evidence references.*dependency declaration.*evaluation basis.*change reasons.*context digest.*locator excerpts.*input skeleton/,
  /pinned policy:.*feature flag.*quality gate.*rollback stops new v2 writes.*existing session policy.*never mixes v1 and v2 scores/,
];

test('v2 evaluation procedures are present in every maintained verifier and worker copy', () => {
  for (const name of ['sg-verifier', 'sg-worker']) {
    const files = [path.resolve(canonicalAgentsDir, name + '.md'),
      ...agentsDirs.map(dir => path.resolve(dir, name + '.md')),
      path.resolve(repoRoot, '.codex', 'agents', name + '.toml')];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const procedure of v2Procedures) {
        assert.match(content, procedure, file + ' lacks procedure ' + procedure);
        assert.doesNotMatch(content.replace(procedure, ''), procedure,
          file + ' removal fixture must detect missing procedure ' + procedure);
      }
    }
  }
});

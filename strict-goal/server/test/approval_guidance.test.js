import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
test('全配布スキルと承認を扱うエージェント定義に旧承認経路を案内しない', () => {
  const files = ['strict-goal/skills/strict-goal/SKILL.md', '.agents/skills/strict-goal/SKILL.md', '.claude/skills/strict-goal/SKILL.md', '.codex/skills/strict-goal/SKILL.md'];
  for (const base of ['strict-goal/agents', '.agents/agents', '.claude/agents', '.codex/agents']) {
    for (const name of ['sg-coder', 'sg-designer', 'sg-implementer', 'sg-verifier']) {
      files.push(`${base}/${name}${base === '.codex/agents' ? '.toml' : '.md'}`);
    }
  }
  for (const file of files) {
    const content = readFileSync(fileURLToPath(new URL(file, root)), 'utf8');
    assert.doesNotMatch(content, /human_token|token_file|token_path|E_TOKEN_INVALID|legacy token|token-based/i, file);
    assert.match(content, /chain_budget_exhausted|chain budget/, file);
    assert.match(content, /approval_action:"reopen"/, file);
    assert.match(content, /verbatim/, file);
  }
});

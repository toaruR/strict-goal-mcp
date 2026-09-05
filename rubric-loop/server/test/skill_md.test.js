import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, '..', '..', 'skills');
const skillFile = path.resolve(skillsDir, 'rubric-loop', 'SKILL.md');

test('SKILL.md に7見出しがすべて存在する（日英両対応）', () => {
  const content = readFileSync(skillFile, 'utf8');
  const requiredHeadingPairs = [
    ['原則', 'Principles'],
    ['モードの選び方', 'Choosing a Mode', 'Mode Selection'],
    ['手順', 'Procedure', 'Workflow', 'Steps'],
    ['上流が変わったと言われたら', 'When Upstream Changes'],
    ['上流が間違っていると気づいたら', 'When Upstream Is Flawed', 'When Upstream Has Flaws'],
    ['文脈を失ったとき', 'When Context Is Lost', 'Lost Context'],
    ['ツールが使えないとき（縮退）', 'Degraded Mode', 'When Server Is Unavailable', 'Fallback'],
  ];

  for (const pair of requiredHeadingPairs) {
    const matched = pair.some((heading) => content.includes(heading));
    assert.ok(
      matched,
      `None of expected headings [${pair.join(' / ')}] found in SKILL.md`,
    );
  }
});

test('SKILL.md 中の FINAL の出現がすべて「サーバだけが出す語である」旨の記述であり、スキルが FINAL を宣言する手順が無い（日英両対応）', () => {
  const content = readFileSync(skillFile, 'utf8');
  const lines = content.split('\n');
  const finalLines = lines.filter((line) => line.includes('FINAL'));

  assert.ok(finalLines.length > 0);
  for (const line of finalLines) {
    // Check that every mention is about server authority or not claiming FINAL (JA or EN)
    const isServerAuthority =
      line.includes('サーバのみ') ||
      line.includes('サーバが判定した結果が FINAL') ||
      line.includes('禁止') ||
      line.includes('名乗らない') ||
      line.includes('自ら FINAL') ||
      /server only|server alone|server determines|returns FINAL|prohibited|forbidden|never claim|do not claim|must not claim/i.test(line);

    assert.ok(
      isServerAuthority,
      `Unexpected use of FINAL without specifying server authority: "${line}"`,
    );
  }
});

test('「文脈を失ったとき」節の手順が loop_state の呼び出し1回だけで構成され、他ツールの呼び出しを含まない（日英両対応）', () => {
  const content = readFileSync(skillFile, 'utf8');
  const contextHeadings = ['文脈を失ったとき', 'When Context Is Lost', 'Lost Context'];
  const matchedHeading = contextHeadings.find((h) => content.includes(h));
  assert.ok(matchedHeading, 'Context section heading not found');

  const section = content.split(matchedHeading)[1].split('##')[0];
  assert.ok(section.includes('loop_state'));
  assert.ok(!section.includes('loop_open'));
  assert.ok(!section.includes('artifact_commit'));
  assert.ok(!section.includes('score_submit'));
  assert.ok(!section.includes('escalate'));
});

test('スキルが1本だけであること（skills/ 配下のディレクトリが1つ）', () => {
  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0].name, 'rubric-loop');
});

test('SKILL.md に資格情報および絶対パスが1件も無い', () => {
  const content = readFileSync(skillFile, 'utf8');
  // Check for absolute paths like /home, C:\, D:\
  const lines = content.split('\n');
  for (const line of lines) {
    // allow markdown tables like |---|
    if (line.startsWith('|')) continue;
    assert.ok(!/[A-Za-z]:[\\/]/.test(line), `Windows absolute path found: "${line}"`);
    assert.ok(!/\s+\/[a-z]/.test(line), `Unix absolute path found: "${line}"`);
  }
});

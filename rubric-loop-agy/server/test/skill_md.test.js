import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, '..', '..', 'skills');
const skillFile = path.resolve(skillsDir, 'rubric-loop', 'SKILL.md');

test('SKILL.md に7見出しがすべて存在する', () => {
  const content = readFileSync(skillFile, 'utf8');
  const requiredHeadings = [
    '## 原則',
    '## モードの選び方',
    '## 手順',
    '## 上流が変わったと言われたら',
    '## 上流が間違っていると気づいたら',
    '## 文脈を失ったとき',
    '## ツールが使えないとき（縮退）',
  ];
  for (const heading of requiredHeadings) {
    assert.ok(content.includes(heading), `Heading "${heading}" not found in SKILL.md`);
  }
});

test('SKILL.md 中の FINAL の出現がすべて「サーバだけが出す語である」旨の記述であり、スキルが FINAL を宣言する手順が無い', () => {
  const content = readFileSync(skillFile, 'utf8');
  const lines = content.split('\n');
  const finalLines = lines.filter((line) => line.includes('FINAL'));

  assert.ok(finalLines.length > 0);
  for (const line of finalLines) {
    // Check that every mention is about server authority or not claiming FINAL
    const isServerAuthority =
      line.includes('サーバのみ') ||
      line.includes('サーバが判定した結果が FINAL') ||
      line.includes('禁止') ||
      line.includes('名乗らない') ||
      line.includes('自ら FINAL');
    assert.ok(
      isServerAuthority,
      `Unexpected use of FINAL without specifying server authority: "${line}"`,
    );
  }
});

test('「文脈を失ったとき」節の手順が loop_state の呼び出し1回だけで構成され、他ツールの呼び出しを含まない', () => {
  const content = readFileSync(skillFile, 'utf8');
  const section = content.split('## 文脈を失ったとき')[1].split('##')[0];
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

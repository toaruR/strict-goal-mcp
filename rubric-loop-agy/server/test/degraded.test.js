import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillFile = path.resolve(__dirname, '..', '..', 'skills', 'rubric-loop', 'SKILL.md');

test('縮退節に「FINAL を名乗らない」旨が明記されている', () => {
  const content = readFileSync(skillFile, 'utf8');
  const degradedSection = content.split('## ツールが使えないとき（縮退）')[1];
  assert.ok(degradedSection);
  assert.ok(degradedSection.includes('FINAL を名乗らない'));
});

test('UNVERIFIED-COMPLETE の書式が成果物先頭に書く文字列として指定されている', () => {
  const content = readFileSync(skillFile, 'utf8');
  const degradedSection = content.split('## ツールが使えないとき（縮退）')[1];
  assert.ok(degradedSection.includes('UNVERIFIED-COMPLETE: rubric-loop server unavailable'));
  assert.ok(degradedSection.includes('冒頭'));
});

test('3モード（design, plan, implement）それぞれの縮退要件が明記されている', () => {
  const content = readFileSync(skillFile, 'utf8');
  const degradedSection = content.split('## ツールが使えないとき（縮退）')[1];
  assert.ok(degradedSection.includes('design'));
  assert.ok(degradedSection.includes('plan'));
  assert.ok(degradedSection.includes('implement'));
  assert.ok(degradedSection.includes('自己採点表'));
  assert.ok(degradedSection.includes('トポロジカルソート'));
  assert.ok(degradedSection.includes('テストの実行結果'));
});

test('fallback journal の保存先が明記されている', () => {
  const content = readFileSync(skillFile, 'utf8');
  const degradedSection = content.split('## ツールが使えないとき（縮退）')[1];
  assert.ok(degradedSection.includes('fallback journal'));
  assert.ok(degradedSection.includes('.rubric-loop/fallback-journal.md'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

test('Held-out Suite: Specification verification', async () => {
  const candidateFiles = [
    path.resolve(process.cwd(), 'specification.md'),
    path.resolve(process.cwd(), 'spec.md'),
    path.resolve(process.cwd(), 'docs/specification.md'),
    path.resolve(process.cwd(), 'docs/spec.md'),
  ];

  const target = candidateFiles.find((f) => fs.existsSync(f));
  assert.ok(target, `Specification file not found. Expected one of: ${candidateFiles.join(', ')}`);

  const content = fs.readFileSync(target, 'utf8');
  assert.ok(content.length > 300, `Specification file must be substantial (found ${content.length} bytes)`);

  const lower = content.toLowerCase();

  // 1. API Interface check (algorithm/API naming is left to the candidate, so match on the concept, not fixed identifiers)
  const hasInterface = lower.includes('インターフェース') || lower.includes('interface') || lower.includes('引数') || lower.includes('戻り値') || lower.includes('クラス') || lower.includes('メソッド') || lower.includes('関数');
  assert.ok(hasInterface, 'Specification must define an externally callable interface (class/function, arguments, return values)');

  // 2. Boundary condition / edge cases check
  const hasBoundary = lower.includes('boundary') || lower.includes('境界') || lower.includes('エッジケース') || lower.includes('edge') || lower.includes('補間') || lower.includes('offset');
  assert.ok(hasBoundary, 'Specification must define boundary conditions or window transition edge cases');

  // 3. Error handling check
  const hasErrorHandling = lower.includes('error') || lower.includes('エラー') || lower.includes('exception') || lower.includes('typeerror') || lower.includes('不正');
  assert.ok(hasErrorHandling, 'Specification must define error handling or error codes for invalid inputs');

  // 4. Memory cleanup / TTL check
  const hasCleanup = lower.includes('cleanup') || lower.includes('ttl') || lower.includes('クリーンアップ') || lower.includes('メモリ') || lower.includes('leak') || lower.includes('破棄');
  assert.ok(hasCleanup, 'Specification must define memory cleanup or TTL policy');
});

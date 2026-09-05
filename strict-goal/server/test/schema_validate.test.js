import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/schema/validate.js';

const toolsSchemaPath = fileURLToPath(new URL('../schemas/tools.json', import.meta.url));
const tools = JSON.parse(readFileSync(toolsSchemaPath, 'utf8')).tools;

test('7ツール分の入力と出力スキーマを持つ', () => {
  const names = Object.keys(tools);
  assert.equal(names.length, 7);
  for (const name of names) {
    assert.ok(tools[name].input, name);
    assert.ok(tools[name].output, name);
  }
});

test('required キー欠落は E_VALIDATION になり detail.path に欠落キー名が入る', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['session_id'], properties: { session_id: { type: 'string' } } };
  assert.throws(
    () => validate(schema, {}),
    (err) => err.code === 'E_VALIDATION' && err.detail.path.includes('session_id'),
  );
});

test('additionalProperties:false で未知キーは E_VALIDATION になる', () => {
  const schema = { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } };
  assert.throws(() => validate(schema, { a: 'x', b: 'y' }), { code: 'E_VALIDATION' });
});

test('pattern 違反は E_VALIDATION になる', () => {
  const schema = { type: 'string', pattern: '^rl_[0-9A-HJKMNP-TV-Z]{26}$' };
  assert.throws(() => validate(schema, 'not-a-handle'), { code: 'E_VALIDATION' });
});

test('minItems 違反は E_VALIDATION になる', () => {
  const schema = { type: 'array', minItems: 1 };
  assert.throws(() => validate(schema, []), { code: 'E_VALIDATION' });
});

test('minLength 違反は E_VALIDATION になる', () => {
  const schema = { type: 'string', minLength: 10 };
  assert.throws(() => validate(schema, 'short'), { code: 'E_VALIDATION' });
});

test('uniqueItems 違反は E_VALIDATION になる', () => {
  const schema = { type: 'array', uniqueItems: true, items: { type: 'string' } };
  assert.throws(() => validate(schema, ['a', 'a']), { code: 'E_VALIDATION' });
});

test('正当な値は例外を投げない', () => {
  const result = validate(tools.loop_open.input, { mode: 'create', submission_id: 'abcdefgh', loop_mode: 'design', task: 'x'.repeat(20) });
  assert.equal(result, true);
});

test('未対応語彙に遭遇すると黙って通さず E_INTERNAL を投げる', () => {
  const schema = { type: 'object', oneOf: [{ required: ['a'] }] };
  assert.throws(() => validate(schema, { a: 1 }), { code: 'E_INTERNAL' });
});

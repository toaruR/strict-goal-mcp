import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPreset } from '../src/rubric/presets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..', '..');

function autoRatio(preset) {
  const autoCount = preset.criteria.filter((c) => c.verification === 'auto').length;
  return autoCount / preset.criteria.length;
}

test('presets/design.json の criteria が8件であること', () => {
  const preset = loadPreset(pluginRoot, 'design');
  assert.equal(preset.criteria.length, 8);
});

test('presets/plan.json の policy が max_rounds 8 / stall_window 2 / stall_epsilon 0.25 であること', () => {
  const preset = loadPreset(pluginRoot, 'plan');
  assert.equal(preset.policy.max_rounds, 8);
  assert.equal(preset.policy.stall_window, 2);
  assert.equal(preset.policy.stall_epsilon, 0.25);
});

test('presets/implement.json の policy が max_rounds 16 / stall_window 4 / stall_epsilon 0.20 であること', () => {
  const preset = loadPreset(pluginRoot, 'implement');
  assert.equal(preset.policy.max_rounds, 16);
  assert.equal(preset.policy.stall_window, 4);
  assert.equal(preset.policy.stall_epsilon, 0.2);
});

test('verification:auto の比率が design (5/8) / plan 50% / implement 78% であること', () => {
  const design = loadPreset(pluginRoot, 'design');
  const plan = loadPreset(pluginRoot, 'plan');
  const implement = loadPreset(pluginRoot, 'implement');
  assert.equal(autoRatio(design), 5 / 8);
  assert.equal(autoRatio(plan), 4 / 8);
  assert.equal(autoRatio(implement), 7 / 9);
});

test('PLUGIN_ROOT が未解決(null)のとき preset 読み込みが無効化され null を返す', () => {
  assert.equal(loadPreset(null, 'design'), null);
});

test('未知の rubric_preset 名は E_VALIDATION になる', () => {
  assert.throws(() => loadPreset(pluginRoot, 'unknown'), { code: 'E_VALIDATION' });
});

test('presets/design.harness.json の criteria が17件であること', () => {
  const preset = loadPreset(pluginRoot, 'design.harness');
  assert.equal(preset.criteria.length, 17);
  assert.equal(autoRatio(preset), 4 / 17);
});

test('presets/design.harness.json の self_hosting.anchors.9 が追記節の不在を要求していること', () => {
  const preset = loadPreset(pluginRoot, 'design.harness');
  const selfHosting = preset.criteria.find((c) => c.id === 'self_hosting');
  assert.ok(selfHosting.anchors['9'].includes('存在しない'));
  assert.ok(!selfHosting.anchors['9'].includes('番号つき'));
});


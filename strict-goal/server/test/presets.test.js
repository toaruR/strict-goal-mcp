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

test('presets/design.harness.json の criteria が18件であること', () => {
  const preset = loadPreset(pluginRoot, 'design.harness');
  assert.equal(preset.criteria.length, 18);
  assert.equal(autoRatio(preset), 5 / 18);
});

test('presets/design.harness.json の dependency_conformance が外部依存の実測照合を要求していること', () => {
  const preset = loadPreset(pluginRoot, 'design.harness');
  const criterion = preset.criteria.find((c) => c.id === 'dependency_conformance');
  assert.ok(criterion, 'dependency_conformance criterion should exist');
  assert.equal(criterion.verification, 'auto');
  assert.ok(criterion.anchors['9'].includes('実測値'));
  assert.ok(criterion.anchors['9'].includes('引用箇所'));
  assert.ok(criterion.anchors['1'].includes('実在しない'));
});

test('presets/design.harness.json の self_hosting.anchors.9 が追記節の不在を要求していること', () => {
  const preset = loadPreset(pluginRoot, 'design.harness');
  const selfHosting = preset.criteria.find((c) => c.id === 'self_hosting');
  assert.ok(selfHosting.anchors['9'].includes('存在しない'));
  assert.ok(!selfHosting.anchors['9'].includes('番号つき'));
});

test('presets/design.json の internal_consistency.anchors.9 が実行モデル一致と計算量整合を要求していること', () => {
  const preset = loadPreset(pluginRoot, 'design');
  const anchor9 = preset.criteria.find((c) => c.id === 'internal_consistency').anchors['9'];
  assert.ok(anchor9.includes('同期/非同期の一致'));
  assert.ok(anchor9.includes('計算量と明記オーダーの整合'));
});

test('presets/design.json の numeric_roundtrip.anchors.9 が状態遷移シミュレーションを要求していること', () => {
  const preset = loadPreset(pluginRoot, 'design');
  const anchor9 = preset.criteria.find((c) => c.id === 'numeric_roundtrip').anchors['9'];
  assert.ok(anchor9.includes('内部状態のスライド'));
  assert.ok(anchor9.includes('状態遷移シミュレーション'));
});

test('presets/design.json の interface_completeness.anchors.9 が本文使用の設定名の網羅を要求していること', () => {
  const preset = loadPreset(pluginRoot, 'design');
  const anchor9 = preset.criteria.find((c) => c.id === 'interface_completeness').anchors['9'];
  assert.ok(anchor9.includes('本文が使用する設定名が全て存在する'));
});

test('presets/design.harness.json の numeric_roundtrip / interface_completeness が design.json と同一文言であること', () => {
  const design = loadPreset(pluginRoot, 'design');
  const harness = loadPreset(pluginRoot, 'design.harness');
  for (const id of ['numeric_roundtrip', 'interface_completeness']) {
    const expected = design.criteria.find((c) => c.id === id).anchors['9'];
    const actual = harness.criteria.find((c) => c.id === id).anchors['9'];
    assert.equal(actual, expected);
  }
  assert.ok(harness.criteria.find((c) => c.id === 'numeric_roundtrip').anchors['9'].includes('内部状態のスライド'));
  assert.ok(
    harness.criteria.find((c) => c.id === 'interface_completeness').anchors['9'].includes('本文が使用する設定名が全て存在する')
  );
});

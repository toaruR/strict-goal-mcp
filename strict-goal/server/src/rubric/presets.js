import path from 'node:path';
import fs from 'node:fs';

const VALID_PRESETS = new Set(['design', 'plan', 'implement', 'design.harness']);
const VALID_MODES = VALID_PRESETS;

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// PLUGIN_ROOT が未解決なら preset 読み込みそのものを無効化する（null を返す）。
// 呼び出し側（loop_open, T021）はこれを「rubric_preset が使えなかった」として扱い、
// rubric も無ければ既存の E_VALIDATION(rubric_or_preset_required) を投げる（§19.5 3174行）。
export function loadPreset(pluginRoot, presetName) {
  if (!VALID_PRESETS.has(presetName)) {
    fail('E_VALIDATION', `unknown rubric_preset: ${presetName}`, { path: '$.rubric_preset' });
  }
  if (!pluginRoot) return null;
  const target = path.join(pluginRoot, 'presets', `${presetName}.json`);
  if (!fs.existsSync(target)) {
    // パッケージにプリセットが同梱されていない = 配布物の欠陥。実行時入力の誤りではない。
    fail('E_INTERNAL', `preset not found: ${target}`, { path: target });
  }
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

export { VALID_MODES, VALID_PRESETS };

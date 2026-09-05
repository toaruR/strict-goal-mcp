import crypto from 'node:crypto';

export function normalize(text) {
  let normalized = text.normalize('NFC');
  normalized = normalized.replace(/\r\n/g, '\n');
  normalized = normalized.replace(/[ \t]+$/gm, '');
  normalized = normalized.replace(/\n*$/, '\n');
  return normalized;
}

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(normalize(text), 'utf8').digest('hex');
}

// normalize() は「末尾改行を1つに揃える」までやるが、こちらは本文中の任意の位置での
// 部分一致（design_refs / evidence の excerpt 照合）を見たいだけなので、末尾改行は強制しない。
export function normalizeForMatch(text) {
  return text.normalize('NFC').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}

// キー昇順の正規化 JSON 文字列化（オブジェクトの再帰、配列の順序は保持）。
export function canonicalStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digestJson(obj) {
  return sha256Hex(canonicalStringify(obj));
}

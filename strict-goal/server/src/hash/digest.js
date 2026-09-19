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

export function normalizeForMatch(text) {
  return text.normalize('NFC').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
}

// 本文中に excerpt が実在するかを照合する。
// 単純な部分一致に加えて、LLM が改行跨ぎで引用したり改行を空白に置換した揺れも
// 連続空白・改行の畳み込み（collapse whitespace）により自動吸収する。
export function matchesExcerpt(body, excerpt) {
  if (typeof body !== 'string' || typeof excerpt !== 'string') return false;
  const normalizedBody = normalizeForMatch(body);
  const normalizedExcerpt = normalizeForMatch(excerpt);
  if (normalizedBody.includes(normalizedExcerpt)) return true;

  const collapseWs = (s) => s.replace(/\s+/gu, ' ').trim();
  const collapsedBody = collapseWs(normalizedBody);
  const collapsedExcerpt = collapseWs(normalizedExcerpt);
  if (collapsedExcerpt.length > 0 && collapsedBody.includes(collapsedExcerpt)) {
    return true;
  }

  return false;
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

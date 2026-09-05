import crypto from 'node:crypto';

// Crockford base32（設計書のハンドル pattern ^rl_[0-9A-HJKMNP-TV-Z]{26}$ と一致する字母）。
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(time, len) {
  let str = '';
  let now = time;
  for (let i = len - 1; i >= 0; i--) {
    const mod = now % 32;
    str = ENCODING[mod] + str;
    now = (now - mod) / 32;
  }
  return str;
}

function encodeRandom(len) {
  const bytes = crypto.randomBytes(len);
  let str = '';
  for (let i = 0; i < len; i++) {
    str += ENCODING[bytes[i] % 32];
  }
  return str;
}

export function generateUlid(now = Date.now()) {
  return encodeTime(now, 10) + encodeRandom(16);
}

export function generateHandle(prefix, now) {
  return `${prefix}${generateUlid(now)}`;
}

export function generateSessionId(now) {
  return generateHandle('rl_', now);
}

export function generateChainId(now) {
  return generateHandle('ch_', now);
}

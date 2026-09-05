import crypto from 'node:crypto';

const CROCKFORD_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateUlid(timestamp = Date.now()) {
  let time = timestamp;
  let timeStr = '';
  for (let i = 0; i < 10; i++) {
    const mod = time % 32;
    timeStr = CROCKFORD_CHARS[mod] + timeStr;
    time = Math.floor(time / 32);
  }

  const randomBytes = crypto.randomBytes(10);
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    // 80 bits = 10 bytes -> 16 chars (each 5 bits)
    const byteIndex = Math.floor((i * 5) / 8);
    const bitOffset = (i * 5) % 8;
    let val = randomBytes[byteIndex] >> (3 - bitOffset);
    if (bitOffset > 3 && byteIndex + 1 < randomBytes.length) {
      val = ((randomBytes[byteIndex] << (bitOffset - 3)) | (randomBytes[byteIndex + 1] >> (11 - bitOffset)));
    }
    randStr += CROCKFORD_CHARS[Math.abs(val) % 32];
  }

  return timeStr + randStr;
}

export function generateSessionId(timestamp = Date.now()) {
  return `rl_${generateUlid(timestamp)}`;
}

export function generateChainId(timestamp = Date.now()) {
  return `ch_${generateUlid(timestamp)}`;
}

export function isValidSessionId(id) {
  return typeof id === 'string' && /^rl_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}

export function isValidChainId(id) {
  return typeof id === 'string' && /^ch_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}

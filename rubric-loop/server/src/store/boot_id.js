import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const LINUX_BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';
const UUID_NAMESPACE = '1b671a64-40d5-491e-99b0-da01ff1f3341';

function uuidv5(name, namespace = UUID_NAMESPACE) {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = crypto.createHash('sha1').update(Buffer.concat([nsBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readInstanceId(dataDir) {
  const instancePath = path.join(dataDir, 'instance_id');
  try {
    return fs.readFileSync(instancePath, 'utf8').trim();
  } catch {
    const id = crypto.randomUUID();
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpPath = `${instancePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, id);
    try {
      fs.renameSync(tmpPath, instancePath);
    } catch {
      // 別プロセスが先に作っていれば、その内容を採用する
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // 無視
      }
      return fs.readFileSync(instancePath, 'utf8').trim();
    }
    return id;
  }
}

export function resolveBootId({
  platform = process.platform,
  dataDir,
  nowMs = Date.now,
  uptimeSeconds = () => os.uptime(),
  readOsBootId = () => fs.readFileSync(LINUX_BOOT_ID_PATH, 'utf8').trim(),
} = {}) {
  if (platform === 'linux') {
    try {
      const bootId = readOsBootId();
      if (bootId) {
        return { boot_id: bootId, boot_id_source: 'os' };
      }
    } catch {
      // フォールバックへ
    }
  }

  try {
    const uptime = uptimeSeconds();
    if (typeof uptime === 'number' && Number.isFinite(uptime)) {
      const bootTimeMs = nowMs() - uptime * 1000;
      const roundedSeconds = Math.round(bootTimeMs / 1000) * 1000;
      const iso = new Date(roundedSeconds).toISOString();
      return { boot_id: uuidv5(iso), boot_id_source: 'os' };
    }
  } catch {
    // フォールバックへ
  }

  return { boot_id: readInstanceId(dataDir), boot_id_source: 'instance' };
}

let cached = null;
export function getBootId(options) {
  if (!cached) {
    cached = resolveBootId(options);
  }
  return cached;
}

export function __resetBootIdCacheForTest() {
  cached = null;
}

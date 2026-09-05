import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function writeAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const randomSuffix = crypto.randomBytes(6).toString('hex');
  const tmpPath = `${targetPath}.${randomSuffix}.tmp`;

  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;

  // 1. write to tmp
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, data, 0, data.length, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // 2. rename with retry for Windows EPERM/EBUSY
  let renamed = false;
  let attempts = 0;
  while (!renamed && attempts < 10) {
    try {
      fs.renameSync(tmpPath, targetPath);
      renamed = true;
    } catch (err) {
      if (['EPERM', 'EBUSY'].includes(err.code) && attempts < 9) {
        attempts++;
        // short busy wait
        const end = Date.now() + 10;
        while (Date.now() < end) {}
      } else {
        try { fs.unlinkSync(tmpPath); } catch {}
        throw err;
      }
    }
  }

  // 3. dir fsync
  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } catch {
      // dir fsync may not be supported on all platforms (like Windows), ignore error
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // ignore
  }
}

export function readJson(targetPath) {
  if (!fs.existsSync(targetPath)) return null;
  const raw = fs.readFileSync(targetPath, 'utf8');
  return JSON.parse(raw);
}

export function writeJson(targetPath, data) {
  const jsonStr = JSON.stringify(data, null, 2) + '\n';
  writeAtomic(targetPath, jsonStr);
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function writeAtomic(targetPath, bytes) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, buffer);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // 消せなくても元の失敗を優先して投げる
    }
    throw err;
  }

  fsyncDir(dir);
}

function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // ディレクトリ fsync 非対応の環境（一部の Windows 構成）では黙って無視する
  }
}

export function readJson(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
}

export function writeJson(targetPath, obj) {
  writeAtomic(targetPath, `${JSON.stringify(obj, null, 2)}\n`);
}

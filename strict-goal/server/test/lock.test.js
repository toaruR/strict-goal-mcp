import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBootId } from '../src/store/boot_id.js';
import { acquireLock, releaseLock } from '../src/store/lock.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'strict-goal-lock-'));
}

test('boot_id: Linux で /proc 経路が読めれば boot_id_source が os になる', () => {
  const result = resolveBootId({ platform: 'linux', readOsBootId: () => 'abc-123-boot' });
  assert.equal(result.boot_id, 'abc-123-boot');
  assert.equal(result.boot_id_source, 'os');
});

test('boot_id: 起動識別子が無く起動時刻だけ取れるホストでは UUIDv5 で同一起動中は同値になる', () => {
  const fixedNow = 1_700_000_000_000;
  const options = {
    platform: 'win32',
    nowMs: () => fixedNow,
    uptimeSeconds: () => 12345,
  };
  const a = resolveBootId(options);
  const b = resolveBootId(options);
  assert.equal(a.boot_id_source, 'os');
  assert.equal(a.boot_id, b.boot_id);
  assert.match(a.boot_id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('boot_id: どちらも取れないとき instance_id を使い boot_id_source が instance になる', () => {
  const dir = tmpDir();
  const result = resolveBootId({
    platform: 'win32',
    dataDir: dir,
    uptimeSeconds: () => {
      throw new Error('uptime unavailable');
    },
  });
  assert.equal(result.boot_id_source, 'instance');
  assert.ok(fs.existsSync(path.join(dir, 'instance_id')));
});

test('LOCK が存在しないとき acquireLock が成功し4キーを書く', () => {
  const dir = tmpDir();
  const bootInfo = { boot_id: 'boot-a', boot_id_source: 'os' };
  acquireLock(dir, bootInfo, { pid: 111, now: 1000 });
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'LOCK'), 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), ['acquired_at', 'boot_id', 'boot_id_source', 'pid']);
});

test('LOCK 保持中に別プロセスが acquireLock すると E_CONCURRENT', () => {
  const dir = tmpDir();
  const bootInfo = { boot_id: 'boot-a', boot_id_source: 'os' };
  acquireLock(dir, bootInfo, { pid: process.pid, now: Date.now() });
  assert.throws(
    () => acquireLock(dir, bootInfo, { pid: 222, now: Date.now() }),
    (err) => err.code === 'E_CONCURRENT'
  );
});

test('boot_id_source が instance のとき acquired_at からの60秒経過のみで陳腐化判定し警告が出る', () => {
  const dir = tmpDir();
  const bootInfo = { boot_id: 'inst-1', boot_id_source: 'instance' };
  acquireLock(dir, bootInfo, { pid: 333, now: 0 });
  const result = acquireLock(dir, bootInfo, { pid: 444, now: 60000 });
  assert.ok(result.warnings.includes('lock_staleness_time_only'));
});

test('acquired_at が60000ミリ秒以上前のLOCKは回収され取得が成功する', () => {
  const dir = tmpDir();
  const bootInfo = { boot_id: 'inst-1', boot_id_source: 'instance' };
  acquireLock(dir, bootInfo, { pid: 333, now: 0 });
  const result = acquireLock(dir, bootInfo, { pid: 444, now: 60000 });
  assert.equal(result.ok, true);
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'LOCK'), 'utf8'));
  assert.equal(record.pid, 444);
});

test('acquired_at が59000ミリ秒前のLOCKは回収されず E_CONCURRENT になる', () => {
  const dir = tmpDir();
  const bootInfo = { boot_id: 'inst-1', boot_id_source: 'instance' };
  acquireLock(dir, bootInfo, { pid: 333, now: 0 });
  assert.throws(
    () => acquireLock(dir, bootInfo, { pid: 444, now: 59000 }),
    (err) => err.code === 'E_CONCURRENT'
  );
});

test('boot_id_source が異なる2つのLOCKを比較するとき同一boot_idとみなさず時間のみで判定する', () => {
  const dir = tmpDir();
  acquireLock(dir, { boot_id: 'boot-a', boot_id_source: 'os' }, { pid: 333, now: 0 });
  const result = acquireLock(dir, { boot_id: 'boot-a', boot_id_source: 'instance' }, { pid: 444, now: 60000 });
  assert.equal(result.ok, true);
});

test('releaseLock 後に LOCK ファイルが消えている', () => {
  const dir = tmpDir();
  acquireLock(dir, { boot_id: 'boot-a', boot_id_source: 'os' }, { pid: 333, now: 0 });
  releaseLock(dir);
  assert.ok(!fs.existsSync(path.join(dir, 'LOCK')));
});

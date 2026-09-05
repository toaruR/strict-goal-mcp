import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeAtomic, readJson, writeJson } from '../src/store/atomic.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'strict-goal-atomic-'));
}

test('writeAtomic 完了後、書いた全バイトが読み出せる', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'x.txt');
  writeAtomic(target, 'hello world');
  assert.equal(fs.readFileSync(target, 'utf8'), 'hello world');
});

test('writeAtomic 後に *.tmp が同ディレクトリに残らない', () => {
  const dir = tmpDir();
  writeAtomic(path.join(dir, 'x.txt'), 'content');
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('rename 後にディレクトリ fsync を呼ぶ', () => {
  const dir = tmpDir();
  const original = fs.fsyncSync;
  const calls = [];
  fs.fsyncSync = (...args) => {
    calls.push(args);
    return original(...args);
  };
  try {
    writeAtomic(path.join(dir, 'x.txt'), 'content');
  } finally {
    fs.fsyncSync = original;
  }
  assert.ok(calls.length >= 2, 'tmp fsync と dir fsync の両方が呼ばれること');
});

test('write の途中で失敗しても対象パスは旧内容のままか存在しないかのどちらか', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'x.txt');
  writeAtomic(target, 'old content');

  const original = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('simulated rename failure');
  };
  try {
    assert.throws(() => writeAtomic(target, 'new content'));
  } finally {
    fs.renameSync = original;
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'old content');
  const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('writeJson / readJson が往復する', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'x.json');
  writeJson(target, { a: 1, b: 'two' });
  assert.deepEqual(readJson(target), { a: 1, b: 'two' });
});

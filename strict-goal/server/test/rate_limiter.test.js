import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/ratelimit/rate_limiter.js';

function fakeClock(start = 0) {
  let t = start;
  const now = () => t;
  const advance = (ms) => {
    t += ms;
  };
  return { now, advance };
}

test('capacity 分まではバーストで許可される', () => {
  const { now } = fakeClock();
  const limiter = new RateLimiter({ capacity: 3, refillPerSec: 1, now });
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), false);
});

test('トークン枯渇後は refillPerSec に応じて時間経過で回復する', () => {
  const { now, advance } = fakeClock();
  const limiter = new RateLimiter({ capacity: 2, refillPerSec: 1, now });
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), true);
  assert.equal(limiter.tryAcquire(), false);

  advance(500);
  assert.equal(limiter.tryAcquire(), false, '0.5 秒では 1 トークン分に満たない');

  advance(600);
  assert.equal(limiter.tryAcquire(), true, '合計 1.1 秒経過で 1 トークン以上回復している');
});

test('補充量は capacity で頭打ちになる', () => {
  const { now, advance } = fakeClock();
  const limiter = new RateLimiter({ capacity: 2, refillPerSec: 1, now });
  advance(10_000);
  assert.equal(limiter.getAvailableTokens(), 2);
});

test('cost を指定して複数トークンをまとめて消費できる', () => {
  const { now } = fakeClock();
  const limiter = new RateLimiter({ capacity: 5, refillPerSec: 1, now });
  assert.equal(limiter.tryAcquire(3), true);
  assert.equal(limiter.getAvailableTokens(), 2);
  assert.equal(limiter.tryAcquire(3), false, '残り2トークンでは cost:3 を賄えない');
});

test('不正なコンストラクタ引数は RangeError になる', () => {
  assert.throws(() => new RateLimiter({ capacity: 0, refillPerSec: 1 }), RangeError);
  assert.throws(() => new RateLimiter({ capacity: 1, refillPerSec: 0 }), RangeError);
  assert.throws(() => new RateLimiter({ capacity: -1, refillPerSec: 1 }), RangeError);
});

test('tryAcquire に不正な cost を渡すと RangeError になる', () => {
  const limiter = new RateLimiter({ capacity: 1, refillPerSec: 1 });
  assert.throws(() => limiter.tryAcquire(0), RangeError);
  assert.throws(() => limiter.tryAcquire(-1), RangeError);
});

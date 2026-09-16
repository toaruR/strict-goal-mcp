// トークンバケット方式のレートリミッタ。capacity 個までバーストを許し、refillPerSec で毎秒補充する。
export class RateLimiter {
  constructor({ capacity, refillPerSec, now = () => Date.now() } = {}) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError('capacity must be a positive number');
    }
    if (!Number.isFinite(refillPerSec) || refillPerSec <= 0) {
      throw new RangeError('refillPerSec must be a positive number');
    }
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.tokens = capacity;
    this.lastRefill = now();
  }

  #refill() {
    const current = this.now();
    const elapsedSec = Math.max(0, current - this.lastRefill) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.lastRefill = current;
    }
  }

  tryAcquire(cost = 1) {
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new RangeError('cost must be a positive number');
    }
    this.#refill();
    if (this.tokens < cost) {
      return false;
    }
    this.tokens -= cost;
    return true;
  }

  getAvailableTokens() {
    this.#refill();
    return this.tokens;
  }
}

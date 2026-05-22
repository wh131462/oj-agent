import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RateLimiter } from '../src/http/rate-limiter.js';
import { RateLimitError } from '../src/ai/types.js';

test('RateLimiter: 超额抛 RateLimitError', () => {
  let now = 1_000_000;
  const rl = new RateLimiter(() => 3, () => now);
  rl.tryConsume('ai');
  rl.tryConsume('ai');
  rl.tryConsume('ai');
  assert.throws(() => rl.tryConsume('ai'), RateLimitError);
});

test('RateLimiter: 滑窗外的请求被释放', () => {
  let now = 1_000_000;
  const rl = new RateLimiter(() => 2, () => now);
  rl.tryConsume('ai');
  rl.tryConsume('ai');
  now += 60_001;
  rl.tryConsume('ai'); // 窗口推进，不应抛
});

test('RateLimiter: 不同 bucket 独立计数', () => {
  let now = 1_000_000;
  const rl = new RateLimiter(() => 1, () => now);
  rl.tryConsume('ai');
  rl.tryConsume('oj.leetcode');
  // 两个 bucket 各 1 次，未超额
  assert.throws(() => rl.tryConsume('ai'), RateLimitError);
});

import { RateLimitError } from '../ai/types.js';

/** 简单滑动窗口限速器。 */
export class RateLimiter {
  private windows = new Map<string, number[]>();

  constructor(
    private getLimitPerMinute: (bucket: string) => number,
    private now: () => number = () => Date.now(),
  ) {}

  /** 若允许，记录一次；否则抛出 RateLimitError。 */
  tryConsume(bucket: string): void {
    const limit = this.getLimitPerMinute(bucket);
    if (limit <= 0) return;
    const now = this.now();
    const cutoff = now - 60_000;
    const arr = (this.windows.get(bucket) ?? []).filter((t) => t > cutoff);
    if (arr.length >= limit) {
      const earliest = arr[0];
      const retry = Math.ceil((earliest + 60_000 - now) / 1000);
      throw new RateLimitError(Math.max(1, retry));
    }
    arr.push(now);
    this.windows.set(bucket, arr);
  }

  reset(bucket?: string): void {
    if (bucket) this.windows.delete(bucket);
    else this.windows.clear();
  }
}

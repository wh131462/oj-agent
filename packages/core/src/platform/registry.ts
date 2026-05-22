/**
 * 平台适配器注册表。统一注入依赖,按 id lazy 创建并缓存适配器实例。
 */

import type { HttpClient } from '../http/client.js';
import type { RateLimiter } from '../http/rate-limiter.js';
import type { CredentialStore } from '../auth/credential-store.js';
import type { PlatformAdapter, PlatformId } from './adapter.js';
import { LeetCodeCnAdapter } from './leetcode-cn/index.js';
import { HDOJAdapter } from './hdoj/index.js';

export interface RegistryDeps {
  httpClient: HttpClient;
  credentialStore: CredentialStore;
  rateLimiter: RateLimiter;
}

export class PlatformAdapterRegistry {
  private readonly cache = new Map<PlatformId, PlatformAdapter>();

  constructor(private readonly deps: RegistryDeps) {}

  get(id: PlatformId): PlatformAdapter {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const adapter = this.createAdapter(id);
    this.cache.set(id, adapter);
    return adapter;
  }

  private createAdapter(id: PlatformId): PlatformAdapter {
    switch (id) {
      case 'leetcode-cn':
        return new LeetCodeCnAdapter(this.deps);
      case 'hdoj':
        return new HDOJAdapter(this.deps);
      case 'codeforces':
      case 'luogu':
      case 'poj':
      case 'lanqiao':
        throw new Error(`平台 '${id}' 尚未实现(M1 仅支持 leetcode-cn 与 hdoj)`);
      default: {
        const _exhaustive: never = id;
        throw new Error(`未知平台: ${String(_exhaustive)}`);
      }
    }
  }
}

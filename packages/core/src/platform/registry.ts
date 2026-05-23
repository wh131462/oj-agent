/**
 * 平台适配器注册表。统一注入依赖,按 id lazy 创建并缓存适配器实例。
 */

import type { HttpClient } from '../http/client.js';
import type { RateLimiter } from '../http/rate-limiter.js';
import type { CredentialStore } from '../auth/credential-store.js';
import type { PlatformAdapter, PlatformId } from './adapter.js';
import { LeetCodeCnAdapter } from './leetcode-cn/index.js';
import { HDOJAdapter } from './hdoj/index.js';
import { CodeforcesAdapter } from './codeforces/index.js';
import { LuoguAdapter } from './luogu/index.js';
import { POJAdapter } from './poj/index.js';
import { LanqiaoAdapter } from './lanqiao/index.js';

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
        return new CodeforcesAdapter(this.deps);
      case 'luogu':
        return new LuoguAdapter(this.deps);
      case 'poj':
        return new POJAdapter(this.deps);
      case 'lanqiao':
        return new LanqiaoAdapter(this.deps);
      default: {
        const _exhaustive: never = id;
        throw new Error(`未知平台: ${String(_exhaustive)}`);
      }
    }
  }
}

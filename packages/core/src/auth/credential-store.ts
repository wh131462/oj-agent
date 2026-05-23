/**
 * 平台凭证仓库。基于已有的 `SecretBackend`(AI 复用),
 * 键名 `oj.cookie.<platform>`,与 `ai.apiKey.*` 严格隔离。
 * 可选注入 SharedConfigStore 以同步持久化 session 到共享文件。
 */

import type { SecretBackend } from '../ai/api-key-vault.js';
import type { PlatformId, PlatformCredential } from '../platform/adapter.js';
import type { SharedConfigStore } from '../shared-config/store.js';

export const OJ_COOKIE_PREFIX = 'oj.cookie.';

export interface Disposable {
  dispose(): void;
}

export type CredentialChangeListener = (platform: PlatformId) => void;

export interface CredentialStore {
  get(platform: PlatformId): Promise<PlatformCredential | undefined>;
  set(platform: PlatformId, cred: PlatformCredential): Promise<void>;
  delete(platform: PlatformId): Promise<void>;
  onChange(listener: CredentialChangeListener): Disposable;
}

export interface SecretCredentialStoreOptions {
  sharedConfigStore?: SharedConfigStore;
}

export class SecretCredentialStore implements CredentialStore {
  private readonly listeners = new Set<CredentialChangeListener>();
  private readonly sharedConfigStore?: SharedConfigStore;

  constructor(
    private readonly backend: SecretBackend,
    opts: SecretCredentialStoreOptions = {},
  ) {
    this.sharedConfigStore = opts.sharedConfigStore;
  }

  /** 从 SharedConfigStore 加载已有 session 并注入 SecretBackend（初始化时调用）。 */
  async loadFromSharedStore(): Promise<void> {
    if (!this.sharedConfigStore) return;
    const sessions = await this.sharedConfigStore.getAllSessions();
    for (const [platform, cred] of Object.entries(sessions)) {
      const key = this.keyOf(platform as PlatformId);
      const existing = await this.backend.get(key);
      if (!existing) {
        await this.backend.store(key, JSON.stringify(cred));
      }
    }
  }

  private keyOf(platform: PlatformId): string {
    return `${OJ_COOKIE_PREFIX}${platform}`;
  }

  async get(platform: PlatformId): Promise<PlatformCredential | undefined> {
    const raw = await this.backend.get(this.keyOf(platform));
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as PlatformCredential;
      // 弱校验:必须含 platform
      if (parsed && typeof parsed === 'object' && parsed.platform === platform) {
        return parsed;
      }
      // 兼容:旧版本可能只存 cookie 字符串
      if (typeof raw === 'string' && !raw.startsWith('{')) {
        return { platform, cookie: raw };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async set(platform: PlatformId, cred: PlatformCredential): Promise<void> {
    const value: PlatformCredential = { ...cred, platform };
    await this.backend.store(this.keyOf(platform), JSON.stringify(value));
    if (this.sharedConfigStore) {
      await this.sharedConfigStore.setSession(platform, value);
    }
    this.fire(platform);
  }

  async delete(platform: PlatformId): Promise<void> {
    await this.backend.delete(this.keyOf(platform));
    if (this.sharedConfigStore) {
      await this.sharedConfigStore.deleteSession(platform);
    }
    this.fire(platform);
  }

  onChange(listener: CredentialChangeListener): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  private fire(platform: PlatformId): void {
    for (const l of this.listeners) {
      try {
        l(platform);
      } catch {
        // 容错:监听器异常不影响仓库写入
      }
    }
  }
}

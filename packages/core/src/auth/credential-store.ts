/**
 * 平台凭证仓库。基于已有的 `SecretBackend`(AI 复用),
 * 键名 `oj.cookie.<platform>`,与 `ai.apiKey.*` 严格隔离。
 */

import type { SecretBackend } from '../ai/api-key-vault.js';
import type { PlatformId, PlatformCredential } from '../platform/adapter.js';

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

export class SecretCredentialStore implements CredentialStore {
  private readonly listeners = new Set<CredentialChangeListener>();

  constructor(private readonly backend: SecretBackend) {}

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
    this.fire(platform);
  }

  async delete(platform: PlatformId): Promise<void> {
    await this.backend.delete(this.keyOf(platform));
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

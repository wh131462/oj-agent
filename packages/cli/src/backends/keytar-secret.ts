/**
 * KeytarSecretBackend:基于 keytar 的 SecretBackend。
 *
 * 服务名固定 'oj-agent',账号名 = secret key(如 'oj.cookie.leetcode-cn')。
 */

import type { SecretBackend } from '@oj-agent/core';

const SERVICE_NAME = 'oj-agent';

type KeytarModule = {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

export class KeytarSecretBackend implements SecretBackend {
  constructor(private readonly keytar: KeytarModule) {}

  async get(key: string): Promise<string | undefined> {
    const v = await this.keytar.getPassword(SERVICE_NAME, key);
    return v === null ? undefined : v;
  }

  async store(key: string, value: string): Promise<void> {
    await this.keytar.setPassword(SERVICE_NAME, key, value);
  }

  async delete(key: string): Promise<void> {
    await this.keytar.deletePassword(SERVICE_NAME, key);
  }
}

/**
 * Lazy 加载 keytar。
 * 返回 null 表示 keytar 不可用(未装 / 原生构建失败 / Linux 缺 libsecret 等)。
 */
export async function tryLoadKeytar(): Promise<KeytarModule | null> {
  try {
    const m = (await import('keytar')) as unknown as { default?: KeytarModule } & KeytarModule;
    const mod = (m.default ?? m) as KeytarModule;
    // sanity check
    if (typeof mod.setPassword !== 'function') return null;
    // 试探一次 get 以触发原生加载;失败说明 native 模块挂了
    try {
      await mod.getPassword(SERVICE_NAME, '__probe__');
    } catch {
      return null;
    }
    return mod;
  } catch {
    return null;
  }
}

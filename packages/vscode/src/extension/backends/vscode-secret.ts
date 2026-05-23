import * as vscode from 'vscode';
import type { SecretBackend } from '@oj-agent/core';
import type { SharedConfigStore } from '@oj-agent/core';
import { OJ_COOKIE_PREFIX } from '@oj-agent/core';
import type { PlatformId, PlatformCredential } from '@oj-agent/core';

export class VSCodeSecretBackend implements SecretBackend {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly sharedConfigStore?: SharedConfigStore,
  ) {}

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    await this.secrets.store(key, value);
    if (this.sharedConfigStore && key.startsWith(OJ_COOKIE_PREFIX)) {
      const platform = key.slice(OJ_COOKIE_PREFIX.length) as PlatformId;
      try {
        const cred = JSON.parse(value) as PlatformCredential;
        await this.sharedConfigStore.setSession(platform, cred);
      } catch {
        // 容错：解析失败不影响存储
      }
    }
  }

  async delete(key: string): Promise<void> {
    await this.secrets.delete(key);
    if (this.sharedConfigStore && key.startsWith(OJ_COOKIE_PREFIX)) {
      const platform = key.slice(OJ_COOKIE_PREFIX.length) as PlatformId;
      await this.sharedConfigStore.deleteSession(platform).catch(() => {});
    }
  }
}

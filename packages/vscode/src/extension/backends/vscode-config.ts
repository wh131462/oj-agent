import * as vscode from 'vscode';
import type { ConfigBackend, SharedConfigStore, SharedAIConfig } from '@oj-agent/core';

/** AI 配置字段，这些字段优先从 SharedConfigStore 读写 */
const AI_SHARED_KEYS = new Set(['ai.profiles', 'ai.activeProfileId']);

/**
 * VSCode 配置 backend。命名空间默认 `ojAgent`。
 *
 * 实现 core 的 `ConfigBackend`(get/update),并额外提供 `onChange(key, listener)`
 * 用于扩展端订阅细粒度配置变更(底层是 `workspace.onDidChangeConfiguration` 过滤)。
 * 可选注入 SharedConfigStore 以共享 AI 配置。
 */
export class VSCodeConfigBackend implements ConfigBackend {
  private readonly sharedConfigStore?: SharedConfigStore;
  private aiCache?: SharedAIConfig;

  constructor(
    private readonly section: string = 'ojAgent',
    opts: { sharedConfigStore?: SharedConfigStore } = {},
  ) {
    this.sharedConfigStore = opts.sharedConfigStore;
    if (this.sharedConfigStore) {
      this.sharedConfigStore.watch((event) => {
        if (event.type === 'ai-config') {
          this.aiCache = undefined;
        }
      });
      // 异步预加载 AI config 到缓存
      void this.sharedConfigStore.getAIConfig().then((cfg) => {
        this.aiCache = cfg;
      });
    }
  }

  get<T>(key: string): T | undefined {
    if (this.sharedConfigStore && AI_SHARED_KEYS.has(key) && this.aiCache) {
      if (key === 'ai.profiles') return this.aiCache.profiles as unknown as T;
      if (key === 'ai.activeProfileId') return this.aiCache.activeProfileId as unknown as T;
    }
    return vscode.workspace.getConfiguration(this.section).get<T>(key);
  }

  getOr<T>(key: string, defaultValue: T): T {
    const v = this.get<T>(key);
    return v === undefined ? defaultValue : v;
  }

  async update<T>(key: string, value: T): Promise<void> {
    if (this.sharedConfigStore && AI_SHARED_KEYS.has(key)) {
      const current = await this.sharedConfigStore.getAIConfig();
      const patch: Partial<SharedAIConfig> = {};
      if (key === 'ai.profiles') patch.profiles = value as SharedAIConfig['profiles'];
      if (key === 'ai.activeProfileId') patch.activeProfileId = value as string;
      await this.sharedConfigStore.setAIConfig({ ...current, ...patch });
      this.aiCache = { ...current, ...patch };
      return;
    }
    await vscode.workspace
      .getConfiguration(this.section)
      .update(key, value, vscode.ConfigurationTarget.Global);
  }

  /**
   * 订阅指定 key 的变化。key 是相对 section 的子路径,例如 `'platforms.enabled'`,
   * 内部拼成 `'ojAgent.platforms.enabled'` 再调 `affectsConfiguration`。
   */
  onChange(key: string, listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${this.section}.${key}`)) {
        try {
          listener();
        } catch {
          /* ignore listener errors */
        }
      }
    });
  }
}

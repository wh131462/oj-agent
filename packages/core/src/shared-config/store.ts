/**
 * SharedConfigStore: 跨进程共享配置与 session 存储层。
 * - 统一管理 ~/.oj-agent/ 下的 sessions.json 和 ai-config.json
 * - 提供文件 watch 机制（基于 chokidar）供 VSCode 端热加载
 * - 原子写入（临时文件 + fs.rename）
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import chokidar from 'chokidar';
import type { PlatformId, PlatformCredential } from '../platform/adapter.js';
import type { Disposable } from '../auth/credential-store.js';

export interface AIProfile {
  id: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface SharedAIConfig {
  profiles: AIProfile[];
  activeProfileId: string;
}

export interface SharedSession {
  [platform: string]: PlatformCredential;
}

export type ConfigChangeEvent = { type: 'session' } | { type: 'ai-config' };
export type ConfigChangeListener = (event: ConfigChangeEvent) => void;

export interface SharedConfigStoreOptions {
  baseDir?: string;
}

/**
 * SharedConfigStore: 负责读写 ~/.oj-agent/ 下的共享配置文件。
 */
export class SharedConfigStore {
  private readonly baseDir: string;
  private readonly sessionsPath: string;
  private readonly aiConfigPath: string;
  private watcher?: chokidar.FSWatcher;
  private listeners = new Set<ConfigChangeListener>();

  constructor(opts: SharedConfigStoreOptions = {}) {
    this.baseDir = opts.baseDir ?? path.join(os.homedir(), '.oj-agent');
    this.sessionsPath = path.join(this.baseDir, 'sessions.json');
    this.aiConfigPath = path.join(this.baseDir, 'ai-config.json');
  }

  // ---- Session 操作 ----

  async getSession(platform: PlatformId): Promise<PlatformCredential | undefined> {
    const all = await this.readSessions();
    return all[platform];
  }

  async setSession(platform: PlatformId, cred: PlatformCredential): Promise<void> {
    const all = await this.readSessions();
    all[platform] = { ...cred, platform };
    await this.writeSessions(all);
    this.fire({ type: 'session' });
  }

  async deleteSession(platform: PlatformId): Promise<void> {
    const all = await this.readSessions();
    delete all[platform];
    await this.writeSessions(all);
    this.fire({ type: 'session' });
  }

  async getAllSessions(): Promise<SharedSession> {
    return this.readSessions();
  }

  // ---- AI Config 操作 ----

  async getAIConfig(): Promise<SharedAIConfig> {
    return this.readAIConfig();
  }

  async setAIConfig(config: Partial<SharedAIConfig>): Promise<void> {
    const current = await this.readAIConfig();
    const updated: SharedAIConfig = {
      profiles: config.profiles ?? current.profiles,
      activeProfileId: config.activeProfileId ?? current.activeProfileId,
    };
    await this.writeAIConfig(updated);
    this.fire({ type: 'ai-config' });
  }

  // ---- Watch 机制 ----

  watch(listener: ConfigChangeListener): Disposable {
    this.listeners.add(listener);

    if (!this.watcher) {
      this.watcher = chokidar.watch([this.sessionsPath, this.aiConfigPath], {
        persistent: true,
        ignoreInitial: true,
      });

      this.watcher.on('change', (filePath: string) => {
        const event: ConfigChangeEvent =
          filePath === this.sessionsPath ? { type: 'session' } : { type: 'ai-config' };
        this.fire(event);
      });
    }

    return {
      dispose: () => {
        this.listeners.delete(listener);
        if (this.listeners.size === 0 && this.watcher) {
          void this.watcher.close();
          this.watcher = undefined;
        }
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
    }
    this.listeners.clear();
  }

  // ---- 内部辅助 ----

  private async readSessions(): Promise<SharedSession> {
    try {
      const raw = await fs.readFile(this.sessionsPath, 'utf-8');
      return JSON.parse(raw) as SharedSession;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return {};
      throw e;
    }
  }

  private async writeSessions(data: SharedSession): Promise<void> {
    await this.atomicWrite(this.sessionsPath, JSON.stringify(data, null, 2));
  }

  private async readAIConfig(): Promise<SharedAIConfig> {
    try {
      const raw = await fs.readFile(this.aiConfigPath, 'utf-8');
      return JSON.parse(raw) as SharedAIConfig;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return { profiles: [], activeProfileId: '' };
      throw e;
    }
  }

  private async writeAIConfig(data: SharedAIConfig): Promise<void> {
    await this.atomicWrite(this.aiConfigPath, JSON.stringify(data, null, 2));
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    const tmp = filePath + '.tmp-' + Math.random().toString(36).slice(2, 8);
    try {
      await fs.writeFile(tmp, content, { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(tmp, filePath);
    } catch (e) {
      await fs.unlink(tmp).catch(() => {});
      throw e;
    }
  }

  private fire(event: ConfigChangeEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // 容错：监听器异常不影响存储
      }
    }
  }
}

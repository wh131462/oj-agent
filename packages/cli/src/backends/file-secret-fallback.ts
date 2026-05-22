/**
 * FileSecretFallback:keytar 不可用时的回退后端。
 *
 * 路径:<configDir>/secrets.json(与 config.toml 同级)
 * 权限:文件 0600,目录 0700(Unix);Windows 容忍失败。
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SecretBackend } from '@oj-agent/core';

export class FileSecretFallback implements SecretBackend {
  private cache: Record<string, string> | null = null;

  constructor(private readonly filePath: string) {}

  async get(key: string): Promise<string | undefined> {
    const data = await this.load();
    return data[key];
  }

  async store(key: string, value: string): Promise<void> {
    const data = await this.load();
    data[key] = value;
    await this.save(data);
  }

  async delete(key: string): Promise<void> {
    const data = await this.load();
    delete data[key];
    await this.save(data);
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.cache = JSON.parse(raw) as Record<string, string>;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw e;
      this.cache = {};
    }
    return this.cache;
  }

  private async save(data: Record<string, string>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tmp = this.filePath + '.tmp-' + Math.random().toString(36).slice(2, 8);
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', {
        encoding: 'utf-8',
        mode: 0o600,
      });
      await fs.rename(tmp, this.filePath);
      this.cache = data;
    } catch (e) {
      await fs.unlink(tmp).catch(() => {});
      throw e;
    }
  }
}

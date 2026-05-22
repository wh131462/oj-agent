/**
 * TomlConfigBackend:CLI 端的 ConfigBackend 实现。
 * - 配置文件路径解析:--config > $OJ_AGENT_CONFIG > XDG / APPDATA 默认
 * - 字段 schema 内化(类型 + 默认值 + 约束)
 * - 原子写(临时文件 + rename)
 */

import { promises as fs, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as toml from '@iarna/toml';
import type { ConfigBackend } from '@oj-agent/core';
import { UsageError } from '../utils/args.js';

export type ConfigValue = string | number | boolean | string[] | Record<string, unknown> | unknown[];

interface FieldSpec {
  type: 'string' | 'number' | 'boolean' | 'array';
  default?: ConfigValue;
  min?: number;
  max?: number;
}

/** 字段 schema(点路径)。未在此表的 key 不允许通过 `oja config set` 写入。 */
export const FIELD_SCHEMA: Record<string, FieldSpec> = {
  'workspace.root': { type: 'string', default: '~/oj-agent-workspace' },
  'http.proxy': { type: 'string', default: '' },
  'http.rateLimit.leetcode-cn': { type: 'number', default: 30, min: 1 },
  'http.rateLimit.hdoj': { type: 'number', default: 60, min: 1 },
  'lang.cpp.compile': { type: 'string', default: 'g++ -O2 -std=c++17 -o {out} {src}' },
  'lang.cpp.run': { type: 'string', default: '{out}' },
  'lang.python3.run': { type: 'string', default: 'python3 {src}' },
  'lang.java.compile': { type: 'string', default: 'javac -d {dir} {src}' },
  'lang.java.run': { type: 'string', default: 'java -cp {dir} {main}' },
  'lang.javascript.run': { type: 'string', default: 'node {src}' },
  'judge.timeoutMs': { type: 'number', default: 3000, min: 100, max: 60_000 },
  'submission.minIntervalMs': { type: 'number', default: 5000, min: 0 },
  'submission.pollTimeoutMs': { type: 'number', default: 60_000, min: 1000 },
  'ui.defaultLang': { type: 'string', default: 'cpp' },
  'ui.defaultPlatform': { type: 'string', default: 'leetcode-cn' },
  // AI(对齐 VSCode ojAgent.ai.*)
  'ai.profiles': { type: 'array', default: [] },
  'ai.activeProfileId': { type: 'string', default: '' },
  'ai.rateLimit.perMinute': { type: 'number', default: 20, min: 1 },
  'ai.privacy.redact': { type: 'boolean', default: true },
};

export function resolveConfigPath(opts: { explicit?: string } = {}): string {
  if (opts.explicit) return path.resolve(opts.explicit);
  if (process.env.OJ_AGENT_CONFIG) return path.resolve(process.env.OJ_AGENT_CONFIG);
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, 'oj-agent', 'config.toml');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, 'oj-agent', 'config.toml');
  return path.join(os.homedir(), '.config', 'oj-agent', 'config.toml');
}

export class TomlConfigBackend implements ConfigBackend {
  private cache: Record<string, unknown> | null = null;
  private readonly filePath: string;
  private loaded = false;

  constructor(opts: { configPath?: string } = {}) {
    this.filePath = resolveConfigPath({ explicit: opts.configPath });
  }

  get path(): string {
    return this.filePath;
  }

  /** ConfigBackend.get<T>(key):返回 raw 值或 undefined。 */
  get<T = unknown>(key: string): T | undefined {
    this.ensureLoadedSync();
    return getDeep(this.cache!, key) as T | undefined;
  }

  /** ConfigBackend.update<T>(key, value):同步更新 + 持久化。 */
  async update<T = unknown>(key: string, value: T): Promise<void> {
    await this.ensureLoaded();
    setDeep(this.cache!, key, value as unknown);
    await this.save();
  }

  /** 带默认值的 get,CLI 内部使用,不在 ConfigBackend 接口中。 */
  getWithDefault<T>(key: string, defaultValue: T): T {
    const v = this.get<T>(key);
    if (v !== undefined) return v;
    const spec = FIELD_SCHEMA[key];
    if (spec?.default !== undefined) return spec.default as T;
    return defaultValue;
  }

  /**
   * 写入 + 持久化。被命令 `config set` 调用,带 schema 校验。
   */
  async setFromString(key: string, rawValue: string): Promise<void> {
    const spec = FIELD_SCHEMA[key];
    if (!spec) {
      throw new UsageError(`未知配置项: ${key}`);
    }
    const value = coerce(spec, rawValue, key);
    await this.ensureLoaded();
    setDeep(this.cache!, key, value);
    await this.save();
  }

  /** 读 raw value(未应用 schema 默认值)用于 `config get` 显示。 */
  async getRaw(key: string): Promise<unknown> {
    await this.ensureLoaded();
    return getDeep(this.cache!, key);
  }

  /** 完整快照(便于 status 命令展示)。 */
  async snapshot(): Promise<Record<string, unknown>> {
    await this.ensureLoaded();
    return this.cache!;
  }

  private ensureLoadedSync(): void {
    if (this.loaded) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      this.cache = toml.parse(raw) as Record<string, unknown>;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw e;
      this.cache = {};
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      this.cache = toml.parse(raw) as Record<string, unknown>;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw e;
      this.cache = {};
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const out = toml.stringify(this.cache as toml.JsonMap);
    const tmp = this.filePath + '.tmp-' + Math.random().toString(36).slice(2, 8);
    try {
      await fs.writeFile(tmp, out, { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(tmp, this.filePath);
    } catch (e) {
      await fs.unlink(tmp).catch(() => {});
      throw e;
    }
  }
}

function getDeep(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setDeep(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next === undefined || typeof next !== 'object' || next === null) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function coerce(spec: FieldSpec, raw: string, key: string): ConfigValue {
  switch (spec.type) {
    case 'string':
      return raw;
    case 'boolean': {
      const v = raw.toLowerCase();
      if (['true', '1', 'yes'].includes(v)) return true;
      if (['false', '0', 'no'].includes(v)) return false;
      throw new UsageError(`配置项 ${key} 期望布尔值,得到: ${raw}`);
    }
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new UsageError(`配置项 ${key} 期望数字,得到: ${raw}`);
      if (spec.min !== undefined && n < spec.min)
        throw new UsageError(`配置项 ${key} 不能小于 ${spec.min}`);
      if (spec.max !== undefined && n > spec.max)
        throw new UsageError(`配置项 ${key} 不能大于 ${spec.max}`);
      return n;
    }
    case 'array': {
      // 简单实现:从 JSON 字符串解析
      try {
        const v = JSON.parse(raw);
        if (!Array.isArray(v)) throw new Error('not an array');
        return v;
      } catch {
        throw new UsageError(`配置项 ${key} 期望 JSON 数组,得到: ${raw}`);
      }
    }
  }
}

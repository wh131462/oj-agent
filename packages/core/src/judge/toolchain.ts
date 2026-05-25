/**
 * 工具链探测。在 PATH 中查找编译器/解释器,缓存 5 分钟。
 *
 * 失败一律静默返回 null,不抛错。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { NoopLogger, type LoggerBackend } from '../logger/logger.js';

export interface ToolInfo {
  path: string;
  version: string;
}

export interface ToolchainSnapshot {
  gpp: ToolInfo | null;
  gcc: ToolInfo | null;
  clangpp: ToolInfo | null;
  python3: ToolInfo | null;
  python: ToolInfo | null;
  javac: ToolInfo | null;
  java: ToolInfo | null;
  node: ToolInfo | null;
}

const TOOL_NAMES: Array<{
  key: keyof ToolchainSnapshot;
  bin: string;
  versionFlag: string;
}> = [
  { key: 'gpp', bin: 'g++', versionFlag: '--version' },
  { key: 'gcc', bin: 'gcc', versionFlag: '--version' },
  { key: 'clangpp', bin: 'clang++', versionFlag: '--version' },
  { key: 'python3', bin: 'python3', versionFlag: '--version' },
  { key: 'python', bin: 'python', versionFlag: '--version' },
  { key: 'javac', bin: 'javac', versionFlag: '--version' },
  { key: 'java', bin: 'java', versionFlag: '--version' },
  { key: 'node', bin: 'node', versionFlag: '--version' },
];

const CACHE_TTL_MS = 5 * 60 * 1000;

export class ToolchainProbe {
  private cached?: { snapshot: ToolchainSnapshot; at: number };
  private readonly logger: LoggerBackend;

  constructor(opts: { logger?: LoggerBackend } = {}) {
    this.logger = opts.logger ?? new NoopLogger();
  }

  async probe(force = false): Promise<ToolchainSnapshot> {
    const now = Date.now();
    if (!force && this.cached && now - this.cached.at < CACHE_TTL_MS) {
      return this.cached.snapshot;
    }
    const snapshot: ToolchainSnapshot = {
      gpp: null,
      gcc: null,
      clangpp: null,
      python3: null,
      python: null,
      javac: null,
      java: null,
      node: null,
    };
    for (const t of TOOL_NAMES) {
      const p = await whichBinary(t.bin);
      if (!p) continue;
      const version = await probeVersion(p, t.versionFlag).catch(() => '');
      snapshot[t.key] = { path: p, version: version.split('\n')[0] || 'unknown' };
    }
    this.cached = { snapshot, at: now };
    this.logger.info('judge', 'toolchain probed', summarize(snapshot));
    return snapshot;
  }

  /** 清缓存。测试与 `--refresh` 用。 */
  reset(): void {
    this.cached = undefined;
  }
}

async function whichBinary(bin: string): Promise<string | null> {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT?.split(';') ?? ['.EXE', '.CMD', '.BAT']) : [''];
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

function probeVersion(bin: string, flag: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [flag], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => (out += b.toString()));
    child.stderr.on('data', (b) => (err += b.toString()));
    child.once('error', reject);
    child.once('close', () => {
      // 一些工具(javac < 9)把 version 输出到 stderr
      resolve((out + err).trim());
    });
    // 安全超时:5 秒
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      reject(new Error('version probe timeout'));
    }, 5000);
  });
}

function summarize(s: ToolchainSnapshot): Record<string, string | null> {
  const r: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(s)) {
    r[k] = v ? v.path : null;
  }
  return r;
}

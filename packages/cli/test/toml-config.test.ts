import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TomlConfigBackend } from '../src/backends/toml-config.js';
import { UsageError } from '../src/utils/args.js';

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'oja-toml-test-'));
}

test('TomlConfigBackend: 默认值生效', () => {
  const dir = path.join(os.tmpdir(), 'oja-no-config-' + Math.random().toString(36).slice(2));
  const cfg = new TomlConfigBackend({ configPath: path.join(dir, 'config.toml') });
  assert.equal(cfg.getWithDefault<string>('workspace.root', '/fallback'), '~/oj-agent-workspace');
});

test('TomlConfigBackend: 文件不存在 get 返回 undefined,不抛', () => {
  const dir = path.join(os.tmpdir(), 'oja-no-config-' + Math.random().toString(36).slice(2));
  const cfg = new TomlConfigBackend({ configPath: path.join(dir, 'config.toml') });
  assert.equal(cfg.get('workspace.root'), undefined);
});

test('TomlConfigBackend: setFromString 持久化 + 后续 get 读到', async () => {
  const dir = await mkTmp();
  try {
    const p = path.join(dir, 'config.toml');
    const cfg = new TomlConfigBackend({ configPath: p });
    await cfg.setFromString('workspace.root', '/tmp/ws');
    const cfg2 = new TomlConfigBackend({ configPath: p });
    assert.equal(cfg2.get('workspace.root'), '/tmp/ws');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('TomlConfigBackend: 未知 key 拒绝写', async () => {
  const dir = await mkTmp();
  try {
    const cfg = new TomlConfigBackend({ configPath: path.join(dir, 'config.toml') });
    await assert.rejects(cfg.setFromString('foo.bar', '1'), UsageError);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('TomlConfigBackend: 数字越界拒绝', async () => {
  const dir = await mkTmp();
  try {
    const cfg = new TomlConfigBackend({ configPath: path.join(dir, 'config.toml') });
    await assert.rejects(cfg.setFromString('judge.timeoutMs', '50'), UsageError);
    await assert.rejects(cfg.setFromString('judge.timeoutMs', '99999'), UsageError);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('TomlConfigBackend: 数字 NaN 拒绝', async () => {
  const dir = await mkTmp();
  try {
    const cfg = new TomlConfigBackend({ configPath: path.join(dir, 'config.toml') });
    await assert.rejects(cfg.setFromString('http.rateLimit.hdoj', 'abc'), UsageError);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('TomlConfigBackend: 嵌套点路径', async () => {
  const dir = await mkTmp();
  try {
    const p = path.join(dir, 'config.toml');
    const cfg = new TomlConfigBackend({ configPath: p });
    await cfg.setFromString('http.rateLimit.hdoj', '60');
    const cfg2 = new TomlConfigBackend({ configPath: p });
    assert.equal(cfg2.get('http.rateLimit.hdoj'), 60);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('TomlConfigBackend: 持久化使用 0600 文件权限', async () => {
  if (process.platform === 'win32') return; // Windows 跳过
  const dir = await mkTmp();
  try {
    const p = path.join(dir, 'config.toml');
    const cfg = new TomlConfigBackend({ configPath: p });
    await cfg.setFromString('workspace.root', '/x');
    const stat = await fs.stat(p);
    // 仅检查 owner-rw 是否设置(忽略平台位)
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

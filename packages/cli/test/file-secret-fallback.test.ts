import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileSecretFallback } from '../src/backends/file-secret-fallback.js';

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'oja-secret-test-'));
}

test('FileSecretFallback: set/get/delete', async () => {
  const dir = await mkTmp();
  try {
    const p = path.join(dir, 'secrets.json');
    const sb = new FileSecretFallback(p);
    assert.equal(await sb.get('k1'), undefined);
    await sb.store('k1', 'v1');
    assert.equal(await sb.get('k1'), 'v1');
    await sb.delete('k1');
    assert.equal(await sb.get('k1'), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('FileSecretFallback: 文件权限 0600(Unix)', async () => {
  if (process.platform === 'win32') return;
  const dir = await mkTmp();
  try {
    const p = path.join(dir, 'secrets.json');
    const sb = new FileSecretFallback(p);
    await sb.store('k', 'v');
    const stat = await fs.stat(p);
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('FileSecretFallback: 不存在文件时返回 undefined', async () => {
  const dir = await mkTmp();
  try {
    const sb = new FileSecretFallback(path.join(dir, 'nope.json'));
    assert.equal(await sb.get('any'), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('FileSecretFallback: 父目录不存在自动创建', async () => {
  const dir = await mkTmp();
  try {
    const p = path.join(dir, 'sub', 'secrets.json');
    const sb = new FileSecretFallback(p);
    await sb.store('k', 'v');
    assert.equal(await sb.get('k'), 'v');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

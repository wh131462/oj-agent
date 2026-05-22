import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  SecretCredentialStore,
  OJ_COOKIE_PREFIX,
} from '../src/auth/credential-store.js';
import { ApiKeyVault } from '../src/ai/api-key-vault.js';
import { MemorySecretBackend } from './_helpers/memory-secret-backend.js';

test('CredentialStore: set/get/delete', async () => {
  const backend = new MemorySecretBackend();
  const store = new SecretCredentialStore(backend);
  await store.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc' });
  const got = await store.get('hdoj');
  assert.equal(got?.platform, 'hdoj');
  assert.equal(got?.cookie, 'PHPSESSID=abc');
  await store.delete('hdoj');
  assert.equal(await store.get('hdoj'), undefined);
});

test('CredentialStore: 键名前缀 oj.cookie.<platform>', async () => {
  const backend = new MemorySecretBackend();
  const store = new SecretCredentialStore(backend);
  await store.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'X' });
  assert.deepEqual(backend.keys(), [`${OJ_COOKIE_PREFIX}leetcode-cn`]);
});

test('CredentialStore: 与 ai.apiKey.* 命名空间互不读取', async () => {
  const backend = new MemorySecretBackend();
  const store = new SecretCredentialStore(backend);
  const vault = new ApiKeyVault(backend);
  await vault.set('default', 'sk-test');
  // ai 设置后,store.get('leetcode-cn') 应仍是 undefined
  assert.equal(await store.get('leetcode-cn'), undefined);
  await store.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc' });
  // 反向:vault.get('default') 不应被 OJ 影响
  assert.equal(await vault.get('default'), 'sk-test');
  // 但读 hdoj 的 vault 应该读不到(虽然 key 不冲突)
  assert.equal(await vault.get('hdoj'), undefined);
});

test('CredentialStore: onChange 触发与 dispose', async () => {
  const backend = new MemorySecretBackend();
  const store = new SecretCredentialStore(backend);
  let count = 0;
  let lastPlatform = '';
  const disp = store.onChange((p) => {
    count++;
    lastPlatform = p;
  });
  await store.set('hdoj', { platform: 'hdoj', cookie: 'X' });
  assert.equal(count, 1);
  assert.equal(lastPlatform, 'hdoj');
  await store.delete('hdoj');
  assert.equal(count, 2);
  disp.dispose();
  await store.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'Y' });
  assert.equal(count, 2);
});

test('CredentialStore: JSON 反序列化失败返回 undefined,不抛错', async () => {
  const backend = new MemorySecretBackend();
  // 直接塞入非 JSON 字符串
  await backend.store(`${OJ_COOKIE_PREFIX}hdoj`, '<<bad json>>');
  const store = new SecretCredentialStore(backend);
  const got = await store.get('hdoj');
  assert.equal(got, undefined);
});

test('CredentialStore: 监听器抛异常不影响仓库写入', async () => {
  const backend = new MemorySecretBackend();
  const store = new SecretCredentialStore(backend);
  store.onChange(() => {
    throw new Error('boom');
  });
  // 不应吞掉异常?当前实现是 try/catch 内部吞,验证不外抛
  await store.set('hdoj', { platform: 'hdoj', cookie: 'X' });
  assert.equal((await store.get('hdoj'))?.cookie, 'X');
});

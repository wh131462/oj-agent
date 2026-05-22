import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PlatformAdapterRegistry } from '../src/platform/registry.js';
import { HttpClient } from '../src/http/client.js';
import { SecretCredentialStore } from '../src/auth/credential-store.js';
import { RateLimiter } from '../src/http/rate-limiter.js';
import { AdapterError } from '../src/platform/errors.js';
import { MemorySecretBackend } from './_helpers/memory-secret-backend.js';

function makeRegistry() {
  const credentialStore = new SecretCredentialStore(new MemorySecretBackend());
  const rateLimiter = new RateLimiter(() => 60);
  const httpClient = new HttpClient({ credentialStore, rateLimiter });
  return new PlatformAdapterRegistry({ httpClient, credentialStore, rateLimiter });
}

test('Registry: get 返回同一实例(引用相等)', () => {
  const reg = makeRegistry();
  const a = reg.get('leetcode-cn');
  const b = reg.get('leetcode-cn');
  assert.equal(a, b);
});

test('Registry: 未实现平台抛错', () => {
  const reg = makeRegistry();
  assert.throws(() => reg.get('codeforces'), /codeforces.*未实现/);
});

test('Registry: 未登录调 submit 抛 AUTH_REQUIRED', async () => {
  const reg = makeRegistry();
  const lc = reg.get('leetcode-cn');
  await assert.rejects(
    () => lc.submit('two-sum', 'cpp', 'int main(){}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );

  const hd = reg.get('hdoj');
  await assert.rejects(
    () => hd.submit('1000', 'cpp', 'int main(){}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('Registry: login() 直接抛 AUTH_REQUIRED(由前端实现)', async () => {
  const reg = makeRegistry();
  await assert.rejects(
    () => reg.get('leetcode-cn').login(),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
  await assert.rejects(
    () => reg.get('hdoj').login(),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { LoginFlow } from '../src/auth/login-flow.js';
import {
  BrowserNotFoundError,
  BrowserLoginCancelledError,
  BrowserLoginTimeoutError,
  type BrowserLoginCapture,
  type LoginConfig,
} from '../src/auth/browser-login.js';
import { SecretCredentialStore } from '../src/auth/credential-store.js';
import { CredentialChecker } from '../src/auth/credential-checker.js';
import { HttpClient } from '../src/http/client.js';
import { MemorySecretBackend } from './_helpers/memory-secret-backend.js';

const TEST_CONFIG: LoginConfig = {
  platform: 'leetcode-cn',
  loginUrl: 'https://example.com/login',
  ready: { cookieName: 'X' },
};

class FakeCapture implements BrowserLoginCapture {
  cancelCalls = 0;
  constructor(
    private behavior:
      | { type: 'success'; cookie: string; username?: string }
      | { type: 'error'; err: Error },
  ) {}
  async capture(_config: LoginConfig) {
    if (this.behavior.type === 'error') throw this.behavior.err;
    return {
      cookie: this.behavior.cookie,
      username: this.behavior.username,
      browserInfo: { name: 'chrome', path: '/x', version: '1' },
    };
  }
  async cancel() {
    this.cancelCalls++;
  }
}

/** 把 CredentialChecker.check 改成可控值。 */
class StubChecker extends CredentialChecker {
  constructor(private status: 'valid' | 'expired' | 'unknown') {
    super(new HttpClient({}));
  }
  async check() {
    return this.status;
  }
}

test('LoginFlow: 成功路径写凭证 + 校验通过 + 返回 ok', async () => {
  const store = new SecretCredentialStore(new MemorySecretBackend());
  const capture = new FakeCapture({
    type: 'success',
    cookie: 'LEETCODE_SESSION=abc; csrftoken=xyz',
    username: 'foo',
  });
  const checker = new StubChecker('valid');
  const flow = new LoginFlow({ capture, credentialStore: store, credChecker: checker });

  const r = await flow.run(TEST_CONFIG);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.username, 'foo');
    assert.equal(r.browserInfo?.name, 'chrome');
  }
  const stored = await store.get('leetcode-cn');
  assert.equal(stored?.cookie, 'LEETCODE_SESSION=abc; csrftoken=xyz');
  assert.equal(stored?.extra?.username, 'foo');
});

test('LoginFlow: 校验未过 -> 回滚凭证,返回 auth-invalid', async () => {
  const store = new SecretCredentialStore(new MemorySecretBackend());
  const capture = new FakeCapture({ type: 'success', cookie: 'X=1' });
  const checker = new StubChecker('expired');
  const flow = new LoginFlow({ capture, credentialStore: store, credChecker: checker });

  const r = await flow.run(TEST_CONFIG);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'auth-invalid');
  }
  // store 应已回滚
  assert.equal(await store.get('leetcode-cn'), undefined);
});

test('LoginFlow: 校验返回 unknown -> auth-invalid', async () => {
  const store = new SecretCredentialStore(new MemorySecretBackend());
  const capture = new FakeCapture({ type: 'success', cookie: 'X=1' });
  const checker = new StubChecker('unknown');
  const flow = new LoginFlow({ capture, credentialStore: store, credChecker: checker });

  const r = await flow.run(TEST_CONFIG);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'auth-invalid');
});

test('LoginFlow: BrowserNotFoundError -> reason=browser-not-found,store 不变', async () => {
  const store = new SecretCredentialStore(new MemorySecretBackend());
  const capture = new FakeCapture({ type: 'error', err: new BrowserNotFoundError() });
  const checker = new StubChecker('valid');
  const flow = new LoginFlow({ capture, credentialStore: store, credChecker: checker });

  const r = await flow.run(TEST_CONFIG);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'browser-not-found');
  assert.equal(await store.get('leetcode-cn'), undefined);
});

test('LoginFlow: BrowserLoginCancelledError -> reason=cancelled', async () => {
  const store = new SecretCredentialStore(new MemorySecretBackend());
  const capture = new FakeCapture({ type: 'error', err: new BrowserLoginCancelledError() });
  const flow = new LoginFlow({
    capture,
    credentialStore: store,
    credChecker: new StubChecker('valid'),
  });
  const r = await flow.run(TEST_CONFIG);
  if (!r.ok) assert.equal(r.reason, 'cancelled');
});

test('LoginFlow: BrowserLoginTimeoutError -> reason=timeout', async () => {
  const store = new SecretCredentialStore(new MemorySecretBackend());
  const capture = new FakeCapture({ type: 'error', err: new BrowserLoginTimeoutError(300_000) });
  const flow = new LoginFlow({
    capture,
    credentialStore: store,
    credChecker: new StubChecker('valid'),
  });
  const r = await flow.run(TEST_CONFIG);
  if (!r.ok) assert.equal(r.reason, 'timeout');
});

test('LoginFlow: 普通 Error -> reason=capture-failed', async () => {
  const store = new SecretCredentialStore(new MemorySecretBackend());
  const capture = new FakeCapture({ type: 'error', err: new Error('something else') });
  const flow = new LoginFlow({
    capture,
    credentialStore: store,
    credChecker: new StubChecker('valid'),
  });
  const r = await flow.run(TEST_CONFIG);
  if (!r.ok) {
    assert.equal(r.reason, 'capture-failed');
    assert.match(r.message, /something else/);
  }
});

test('LoginFlow.cancel: 透传到 capture.cancel', async () => {
  const capture = new FakeCapture({ type: 'success', cookie: 'X=1' });
  const flow = new LoginFlow({
    capture,
    credentialStore: new SecretCredentialStore(new MemorySecretBackend()),
    credChecker: new StubChecker('valid'),
  });
  await flow.cancel();
  assert.equal(capture.cancelCalls, 1);
});

test('LoginFlow.run 严格不抛异常(任何错误都通过 LoginResult 返回)', async () => {
  // 注入会让 store.set 抛错的 backend
  const brokenStore: import('../src/auth/credential-store.js').CredentialStore = {
    async get() {
      return undefined;
    },
    async set() {
      throw new Error('disk full');
    },
    async delete() {},
    onChange() {
      return { dispose() {} };
    },
  };
  const flow = new LoginFlow({
    capture: new FakeCapture({ type: 'success', cookie: 'X=1' }),
    credentialStore: brokenStore,
    credChecker: new StubChecker('valid'),
  });
  const r = await flow.run(TEST_CONFIG);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'capture-failed');
    assert.match(r.message, /disk full/);
  }
});

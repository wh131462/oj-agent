/**
 * HttpClient 单测。覆盖:GBK 编解码、限速、Cookie 注入、超时、重试、错误归一化、代理。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { HttpClient } from '../src/http/client.js';
import { RateLimiter } from '../src/http/rate-limiter.js';
import { AdapterError } from '../src/platform/errors.js';
import { SecretCredentialStore } from '../src/auth/credential-store.js';
import { MemorySecretBackend } from './_helpers/memory-secret-backend.js';
import { encodeForm, decodeBody } from '../src/http/encoding.js';

/** 构造一个可控的 mock fetch:返回响应体 + 可定制 status / headers / 异步 delay。 */
function mockFetch(
  spec: (req: Request) => Promise<{
    status: number;
    bodyBytes: Uint8Array;
    headers?: Record<string, string>;
    delayMs?: number;
  }>,
): { fn: typeof fetch; calls: { url: string; method: string; headers: Record<string, string>; body: string | undefined }[] } {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string | undefined }[] = [];
  const fn: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (init.headers) {
      // 不知道是什么形态,统一通过 Headers
      const h = new Headers(init.headers as HeadersInit);
      h.forEach((v, k) => (headers[k.toLowerCase()] = v));
    }
    const bodyStr = init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : '';
    calls.push({ url, method, headers, body: bodyStr });

    const req = new Request(url, init as RequestInit);
    const r = await spec(req);
    if (r.delayMs) {
      await new Promise((res, _rej) => {
        const t = setTimeout(res, r.delayMs);
        if (init.signal) {
          init.signal.addEventListener('abort', () => {
            clearTimeout(t);
            res(undefined);
          });
        }
      });
      if (init.signal?.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
    }
    return new Response(r.bodyBytes, {
      status: r.status,
      headers: r.headers,
    });
  };
  return { fn, calls };
}

test('encodeForm/decodeBody: UTF-8 双向', async () => {
  const body = await encodeForm({ a: 'b', c: '中文' }, 'utf-8');
  assert.match(body, /^a=b&c=%E4%B8%AD%E6%96%87$/);
  const text = await decodeBody(new TextEncoder().encode('hello'), 'utf-8');
  assert.equal(text, 'hello');
});

test('encodeForm: GBK 编码中文', async () => {
  const body = await encodeForm({ x: '测试' }, 'gbk');
  // 「测试」GBK 字节 b2 e2 ca d4
  assert.equal(body, 'x=%B2%E2%CA%D4');
});

test('encodeForm: GBK 不可表示字符抛错', async () => {
  await assert.rejects(() => encodeForm({ x: '🚀' }, 'gbk'), /GBK 不支持/);
});

test('decodeBody: GBK 解码', async () => {
  const bytes = new Uint8Array([0xb2, 0xe2, 0xca, 0xd4]);
  const text = await decodeBody(bytes, 'gbk');
  assert.equal(text, '测试');
});

test('HttpClient: 基本 GET 与响应解析', async () => {
  const { fn } = mockFetch(async () => ({
    status: 200,
    bodyBytes: new TextEncoder().encode('{"ok":true}'),
    headers: { 'content-type': 'application/json' },
  }));
  const client = new HttpClient({ fetchImpl: fn });
  const res = await client.request({ url: 'https://example.com/' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('HttpClient: 限速触发抛 RATE_LIMITED', async () => {
  const { fn } = mockFetch(async () => ({ status: 200, bodyBytes: new Uint8Array(0) }));
  const rl = new RateLimiter(() => 1);
  const client = new HttpClient({ fetchImpl: fn, rateLimiter: rl });
  await client.request({ url: 'https://a/', rateLimitKey: 'p1' });
  await assert.rejects(
    () => client.request({ url: 'https://a/', rateLimitKey: 'p1' }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'RATE_LIMITED',
  );
});

test('HttpClient: 跨平台限速桶独立', async () => {
  const { fn } = mockFetch(async () => ({ status: 200, bodyBytes: new Uint8Array(0) }));
  const rl = new RateLimiter(() => 1);
  const client = new HttpClient({ fetchImpl: fn, rateLimiter: rl });
  await client.request({ url: 'https://a/', rateLimitKey: 'p1' });
  await client.request({ url: 'https://a/', rateLimitKey: 'p2' });
});

test('HttpClient: Cookie 注入', async () => {
  const { fn, calls } = mockFetch(async () => ({ status: 200, bodyBytes: new Uint8Array(0) }));
  const store = new SecretCredentialStore(new MemorySecretBackend());
  await store.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'LEETCODE_SESSION=abc; csrftoken=xyz' });
  const client = new HttpClient({ fetchImpl: fn, credentialStore: store });
  await client.request({ url: 'https://leetcode.cn/api', injectCookieFor: 'leetcode-cn' });
  assert.equal(calls[0]!.headers['cookie'], 'LEETCODE_SESSION=abc; csrftoken=xyz');
});

test('HttpClient: 未登录时静默不注入 Cookie', async () => {
  const { fn, calls } = mockFetch(async () => ({ status: 200, bodyBytes: new Uint8Array(0) }));
  const store = new SecretCredentialStore(new MemorySecretBackend());
  const client = new HttpClient({ fetchImpl: fn, credentialStore: store });
  await client.request({ url: 'https://leetcode.cn/api', injectCookieFor: 'leetcode-cn' });
  assert.equal(calls[0]!.headers['cookie'], undefined);
});

test('HttpClient: GBK 响应解码', async () => {
  const { fn } = mockFetch(async () => ({
    status: 200,
    bodyBytes: new Uint8Array([0xb2, 0xe2, 0xca, 0xd4]),
  }));
  const client = new HttpClient({ fetchImpl: fn });
  const res = await client.request({
    url: 'http://acm.hdu.edu.cn/',
    responseEncoding: 'gbk',
  });
  assert.equal(res.text, '测试');
});

test('HttpClient: GBK form 提交携带 charset 头', async () => {
  const { fn, calls } = mockFetch(async () => ({ status: 200, bodyBytes: new Uint8Array(0) }));
  const client = new HttpClient({ fetchImpl: fn });
  await client.request({
    url: 'http://acm.hdu.edu.cn/submit.php',
    method: 'POST',
    contentType: 'form',
    formEncoding: 'gbk',
    body: { usercode: 'int main(){/*中文*/}' },
  });
  assert.equal(calls[0]!.headers['content-type'], 'application/x-www-form-urlencoded; charset=gbk');
  // body 中"中文"对应 GBK 字节 d6 d0 ce c4
  assert.match(calls[0]!.body ?? '', /%D6%D0%CE%C4/);
});

test('HttpClient: 超时抛 NETWORK_ERROR', async () => {
  const { fn } = mockFetch(async () => ({
    status: 200,
    bodyBytes: new Uint8Array(0),
    delayMs: 200,
  }));
  const client = new HttpClient({ fetchImpl: fn });
  await assert.rejects(
    () => client.request({ url: 'https://a/', timeoutMs: 50 }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'NETWORK_ERROR',
  );
});

test('HttpClient: GET 5xx 自动重试', async () => {
  let n = 0;
  const { fn, calls } = mockFetch(async () => {
    n++;
    if (n < 3) return { status: 500, bodyBytes: new TextEncoder().encode('boom') };
    return { status: 200, bodyBytes: new TextEncoder().encode('ok') };
  });
  const client = new HttpClient({ fetchImpl: fn });
  const res = await client.request({
    url: 'https://a/',
    retry: { attempts: 2, baseDelayMs: 10 },
  });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
});

test('HttpClient: POST 不自动重试', async () => {
  const { fn, calls } = mockFetch(async () => ({ status: 500, bodyBytes: new Uint8Array(0) }));
  const client = new HttpClient({ fetchImpl: fn });
  await assert.rejects(
    () => client.request({ url: 'https://a/', method: 'POST', retry: { attempts: 3, baseDelayMs: 10 } }),
    (e: Error) => e instanceof AdapterError,
  );
  assert.equal(calls.length, 1);
});

test('HttpClient: 429 抛 RATE_LIMITED 不重试', async () => {
  const { fn, calls } = mockFetch(async () => ({ status: 429, bodyBytes: new Uint8Array(0) }));
  const client = new HttpClient({ fetchImpl: fn });
  await assert.rejects(
    () => client.request({ url: 'https://a/', retry: { attempts: 3, baseDelayMs: 10 } }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'RATE_LIMITED',
  );
  assert.equal(calls.length, 1);
});

test('HttpClient: 401 抛 AUTH_REQUIRED', async () => {
  const { fn } = mockFetch(async () => ({ status: 401, bodyBytes: new TextEncoder().encode('unauthorized') }));
  const client = new HttpClient({ fetchImpl: fn });
  await assert.rejects(
    () => client.request({ url: 'https://a/' }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('HttpClient: 代理选项透传 ProxyAgent', async () => {
  const { fn } = mockFetch(async () => ({ status: 200, bodyBytes: new Uint8Array(0) }));
  let proxyCalled = '';
  const client = new HttpClient({
    fetchImpl: fn,
    proxyUrl: 'http://127.0.0.1:7890',
    proxyAgentFactory: (url) => {
      proxyCalled = url;
      return {} as never;
    },
  });
  await client.request({ url: 'https://a/' });
  assert.equal(proxyCalled, 'http://127.0.0.1:7890');
});

test('HttpClient: 外部 signal abort 抛 NETWORK_ERROR', async () => {
  const { fn } = mockFetch(async () => ({ status: 200, bodyBytes: new Uint8Array(0), delayMs: 500 }));
  const client = new HttpClient({ fetchImpl: fn });
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 30);
  await assert.rejects(
    () => client.request({ url: 'https://a/', signal: ctrl.signal, timeoutMs: 5000 }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'NETWORK_ERROR',
  );
});

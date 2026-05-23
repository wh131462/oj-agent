/**
 * 蓝桥云课适配器单测：公开列表、JWT 鉴权、降级行为。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { LanqiaoAdapter } from '../src/platform/lanqiao/index.js';
import { HttpClient } from '../src/http/client.js';
import { SecretCredentialStore } from '../src/auth/credential-store.js';
import { RateLimiter } from '../src/http/rate-limiter.js';
import { AdapterError } from '../src/platform/errors.js';
import { MemorySecretBackend } from './_helpers/memory-secret-backend.js';

type FetchCall = {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
};

function makeAdapter(
  spec: (
    req: { url: string; method: string; body?: string; headers: Record<string, string> },
  ) => { status: number; body: string; contentType?: string },
) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : undefined;
    const headers: Record<string, string> = {};
    if (init.headers) {
      new Headers(init.headers as HeadersInit).forEach(
        (v, k) => (headers[k.toLowerCase()] = v),
      );
    }
    calls.push({ url, method, body, headers });
    const r = spec({ url, method, body, headers });
    return new Response(r.body, {
      status: r.status,
      headers: { 'content-type': r.contentType ?? 'application/json' },
    });
  };
  const credentialStore = new SecretCredentialStore(new MemorySecretBackend());
  const rateLimiter = new RateLimiter(() => 60);
  const httpClient = new HttpClient({ fetchImpl, credentialStore, rateLimiter });
  const adapter = new LanqiaoAdapter({ httpClient, credentialStore, rateLimiter });
  return { adapter, credentialStore, calls };
}

test('蓝桥: capabilities 声明 + degraded 提示', () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '{}' }));
  assert.equal(adapter.capabilities.listProblems, true);
  assert.equal(adapter.capabilities.submit, true);
  assert.ok(adapter.degraded);
  const caps = adapter.degraded!.map((d) => d.capability);
  assert.ok(caps.includes('getProblem'));
  assert.ok(caps.includes('submit'));
});

test('蓝桥: login() 直接��� AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '{}' }));
  await assert.rejects(
    () => adapter.login(),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('蓝桥: 匿名 listProblems 走公开 API', async () => {
  const body = JSON.stringify({
    count: 2,
    results: [
      { id: 100, name: '单词分析', tags: ['math'], difficulty: 30, difficulty_level: 2 },
      { id: 101, name: '小明的烦恼', tags: ['dp'], difficulty: 80, difficulty_level: 3 },
    ],
  });
  const { adapter, calls } = makeAdapter(() => ({ status: 200, body }));
  const list = await adapter.listProblems({ pageSize: 50 });
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, '100');
  assert.equal(list[0]!.title, '单词分析');
  assert.equal(list[0]!.difficulty, '简单');
  assert.match(calls[0]!.url, /\/api\/v2\/problems\//);
  // 匿名请求不应携带 Authorization
  assert.equal(calls[0]!.headers['authorization'], undefined);
});

test('蓝桥: getProblem 未登录抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '{}' }));
  await assert.rejects(
    () => adapter.getProblem('100'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('蓝桥: getProblem 已登录拼装题面', async () => {
  const detail = JSON.stringify({
    id: 100,
    title: 'A + B',
    description: '输入 a 和 b',
    input: '两个整数',
    output: 'a + b',
    examples: [{ input: '1 2', output: '3' }],
    tags: ['math'],
    difficulty: 1,
    time_limit: 1000,
    memory_limit: 65536,
  });
  const { adapter, credentialStore, calls } = makeAdapter(() => ({
    status: 200,
    body: detail,
  }));
  await credentialStore.set('lanqiao', {
    platform: 'lanqiao',
    token: 'jwt.token.xxx',
  });
  const p = await adapter.getProblem('100');
  assert.equal(p.id, '100');
  assert.equal(p.title, 'A + B');
  assert.equal(p.difficulty, '入门');
  assert.equal(p.samples.length, 1);
  assert.equal(p.samples[0]!.input, '1 2');
  assert.equal(p.timeLimitMs, 1000);
  assert.equal(p.memoryLimitKb, 65536);
  // JWT 必须随 Authorization 透传
  assert.equal(calls[0]!.headers['authorization'], 'JWT jwt.token.xxx');
});

test('蓝桥: getProblem 服务端 401 抛 AUTH_REQUIRED', async () => {
  const { adapter, credentialStore } = makeAdapter(() => ({
    status: 401,
    body: JSON.stringify({ detail: 'Authentication credentials were not provided.' }),
  }));
  await credentialStore.set('lanqiao', { platform: 'lanqiao', token: 'expired' });
  await assert.rejects(
    () => adapter.getProblem('100'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('蓝桥: submit 未登录抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '{}' }));
  await assert.rejects(
    () => adapter.submit('100', 'cpp', 'int main(){}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('蓝桥: submit 已登录返回 submission id', async () => {
  const submitBody = JSON.stringify({ submission_id: 'sub-999' });
  const { adapter, credentialStore } = makeAdapter(({ method }) => {
    if (method === 'POST')
      return { status: 200, body: submitBody };
    return { status: 200, body: '{}' };
  });
  await credentialStore.set('lanqiao', { platform: 'lanqiao', token: 'jwt' });
  const sid = await adapter.submit('100', 'cpp', 'int main(){}');
  assert.equal(sid, 'sub-999');
});

test('蓝桥: pollResult 拿到 Accepted', async () => {
  let n = 0;
  const { adapter, credentialStore } = makeAdapter(() => {
    n++;
    const body =
      n === 1
        ? JSON.stringify({ status: 'running' })
        : JSON.stringify({
            verdict: 'accepted',
            time_used: 12,
            memory_used: 1024,
          });
    return { status: 200, body };
  });
  await credentialStore.set('lanqiao', { platform: 'lanqiao', token: 'jwt' });
  const r = await adapter.pollResult('sub-999');
  assert.equal(r.verdict, 'AC');
  assert.equal(r.timeMs, 12);
  assert.equal(r.memoryKb, 1024);
});

/**
 * POJ 适配器单测：GBK 解码、列表解析、超时重试、提交、轮询。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import iconv from 'iconv-lite';
import { POJAdapter } from '../src/platform/poj/index.js';
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
    req: { url: string; method: string; body?: string; attempt: number },
  ) => { status: number; bytes: Uint8Array },
  opts: { defaultTimeoutMs?: number } = {},
) {
  const calls: FetchCall[] = [];
  let attempt = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    attempt++;
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
    const r = spec({ url, method, body, attempt });
    return new Response(r.bytes, { status: r.status });
  };
  const credentialStore = new SecretCredentialStore(new MemorySecretBackend());
  const rateLimiter = new RateLimiter(() => 60);
  const httpClient = new HttpClient({
    fetchImpl,
    credentialStore,
    rateLimiter,
    defaultTimeoutMs: opts.defaultTimeoutMs,
  });
  const adapter = new POJAdapter({ httpClient, credentialStore, rateLimiter });
  return { adapter, credentialStore, calls };
}

function gbk(s: string): Uint8Array {
  return new Uint8Array(iconv.encode(s, 'gbk'));
}

test('POJ: login() 直接抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, bytes: new Uint8Array(0) }));
  await assert.rejects(
    () => adapter.login(),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('POJ: listProblems 解析题目表', async () => {
  const html = `
<html><body>
<table>
  <tr><th>Title</th></tr>
  <tr>
    <td>&nbsp;</td>
    <td>1000</td>
    <td><a href="problem?id=1000">A + B Problem</a></td>
    <td>50.00%</td>
  </tr>
  <tr>
    <td>&nbsp;</td>
    <td>1001</td>
    <td><a href="problem?id=1001">Exponentiation</a></td>
    <td>30.00%</td>
  </tr>
</table>
</body></html>`;
  const { adapter } = makeAdapter(() => ({ status: 200, bytes: gbk(html) }));
  const list = await adapter.listProblems({ page: 1 });
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, '1000');
  assert.equal(list[0]!.title, 'A + B Problem');
  assert.equal(list[0]!.url, 'http://poj.org/problem?id=1000');
});

test('POJ: getProblem 解析题面 + 样例 + 限制', async () => {
  const html = `
<html><body>
<div class="ptt">A + B Problem</div>
<table>
  <tr><td>
  <b>Time Limit:</b> 1000MS &nbsp;&nbsp; <b>Memory Limit:</b> 65536K
  </td></tr>
</table>
<p class="pst">Description</p>
<div class="ptx">Calculate a + b.</div>
<p class="pst">Input</p>
<div class="ptx">Two integers a and b.</div>
<p class="pst">Output</p>
<div class="ptx">a + b.</div>
<p class="pst">Sample Input</p>
<pre class="sio">1 2</pre>
<p class="pst">Sample Output</p>
<pre class="sio">3</pre>
</body></html>`;
  const { adapter } = makeAdapter(() => ({ status: 200, bytes: gbk(html) }));
  const detail = await adapter.getProblem('1000');
  assert.equal(detail.id, '1000');
  assert.equal(detail.title, 'A + B Problem');
  assert.equal(detail.timeLimitMs, 1000);
  assert.equal(detail.memoryLimitKb, 65536);
  assert.match(detail.statement, /### Description/);
  assert.equal(detail.samples.length, 1);
  assert.equal(detail.samples[0]!.input, '1 2');
  assert.equal(detail.samples[0]!.output, '3');
});

test('POJ: getProblem 不存在抛 NOT_FOUND', async () => {
  const { adapter } = makeAdapter(() => ({
    status: 200,
    bytes: gbk('<html><body>No such problem</body></html>'),
  }));
  await assert.rejects(
    () => adapter.getProblem('99999'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'NOT_FOUND',
  );
});

test('POJ: HttpClient GET 在首次 5xx 时按平台 profile 重试一次', async () => {
  let count = 0;
  const okHtml = gbk(`<html><body>
<table>
<tr><th>x</th></tr>
<tr><td>x</td><td>1000</td><td><a>A + B</a></td><td>1.00%</td></tr>
</table></body></html>`);
  const { adapter, calls } = makeAdapter(({ method }) => {
    if (method === 'GET') {
      count++;
      if (count === 1) return { status: 500, bytes: gbk('upstream') };
      return { status: 200, bytes: okHtml };
    }
    return { status: 200, bytes: new Uint8Array(0) };
  });
  const list = await adapter.listProblems({ page: 1 });
  assert.equal(list.length, 1);
  assert.equal(calls.length, 2);
});

test('POJ: submit 未登录抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, bytes: new Uint8Array(0) }));
  await assert.rejects(
    () => adapter.submit('1000', 'cpp', 'int main(){}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('POJ: submit 不支持语言抛 LANG_UNSUPPORTED', async () => {
  const { adapter, credentialStore } = makeAdapter(() => ({
    status: 200,
    bytes: new Uint8Array(0),
  }));
  await credentialStore.set('poj', { platform: 'poj', cookie: 'JSESSIONID=x', extra: { username: 'me' } });
  await assert.rejects(
    () => adapter.submit('1000', 'python3', 'print(1)'),
    (e: Error) =>
      e instanceof AdapterError && (e as AdapterError).code === 'LANG_UNSUPPORTED',
  );
});

test('POJ: submit 已登录 + 状态页拿到 runId', async () => {
  const statusHtml = gbk(`
<html><body><table class="a">
<tr><th>Run ID</th><th>User</th><th>Problem</th><th>Result</th><th>Memory</th><th>Time</th><th>Language</th><th>Code</th></tr>
<tr><td>5555</td><td>me</td><td>1000</td><td>Compiling</td><td>0K</td><td>0MS</td><td>G++</td><td>50</td></tr>
</table></body></html>`);
  const { adapter, credentialStore, calls } = makeAdapter(({ url, method }) => {
    if (method === 'POST' && url.includes('/submit'))
      return { status: 200, bytes: gbk('<html>ok</html>') };
    if (method === 'GET' && url.includes('/status'))
      return { status: 200, bytes: statusHtml };
    return { status: 404, bytes: gbk('not found') };
  });
  await credentialStore.set('poj', {
    platform: 'poj',
    cookie: 'JSESSIONID=x',
    extra: { username: 'me' },
  });
  const runId = await adapter.submit('1000', 'cpp', 'int main(){}');
  assert.equal(runId, '5555');
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/submit'));
  assert.ok(post);
  assert.match(post!.body!, /problem_id=1000/);
  assert.match(post!.body!, /language=0/);
});

test('POJ: submit 登录失效返回 login 页 -> AUTH_EXPIRED', async () => {
  const loginPage = gbk(`<html><body><form action="login"><input name="user_id1"/></form></body></html>`);
  const { adapter, credentialStore } = makeAdapter(({ method, url }) => {
    if (method === 'POST' && url.includes('/submit'))
      return { status: 200, bytes: loginPage };
    return { status: 200, bytes: gbk('') };
  });
  await credentialStore.set('poj', {
    platform: 'poj',
    cookie: 'expired',
    extra: { username: 'me' },
  });
  await assert.rejects(
    () => adapter.submit('1000', 'cpp', 'int main(){}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_EXPIRED',
  );
});

test('POJ: pollResult 拿到 AC 状态', async () => {
  let n = 0;
  const judgingHtml = gbk(`
<html><body><table class="a">
<tr><th>Run ID</th><th>User</th><th>Problem</th><th>Result</th><th>Memory</th><th>Time</th><th>Language</th><th>Code</th></tr>
<tr><td>5555</td><td>me</td><td>1000</td><td>Running</td><td>0K</td><td>0MS</td><td>G++</td><td>50</td></tr>
</table></body></html>`);
  const acHtml = gbk(`
<html><body><table class="a">
<tr><th>Run ID</th><th>User</th><th>Problem</th><th>Result</th><th>Memory</th><th>Time</th><th>Language</th><th>Code</th></tr>
<tr><td>5555</td><td>me</td><td>1000</td><td>Accepted</td><td>320K</td><td>16MS</td><td>G++</td><td>50</td></tr>
</table></body></html>`);
  const { adapter, credentialStore } = makeAdapter(() => {
    n++;
    return { status: 200, bytes: n === 1 ? judgingHtml : acHtml };
  });
  await credentialStore.set('poj', {
    platform: 'poj',
    cookie: 'JSESSIONID=x',
    extra: { username: 'me' },
  });
  // 缩短退避，加速测试
  const r = await adapter.pollResult('5555');
  assert.equal(r.verdict, 'AC');
  assert.equal(r.timeMs, 16);
  assert.equal(r.memoryKb, 320);
});

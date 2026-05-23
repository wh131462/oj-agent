/**
 * HDOJ 适配器单测。GBK 编解码 + HTML 解析。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import iconv from 'iconv-lite';
import { HDOJAdapter } from '../src/platform/hdoj/index.js';
import { HttpClient } from '../src/http/client.js';
import { SecretCredentialStore } from '../src/auth/credential-store.js';
import { RateLimiter } from '../src/http/rate-limiter.js';
import { AdapterError } from '../src/platform/errors.js';
import { MemorySecretBackend } from './_helpers/memory-secret-backend.js';

type FetchCall = { url: string; method: string; body?: string; headers: Record<string, string> };

function makeAdapter(
  spec: (req: { url: string; method: string; body?: string }) => { status: number; bytes: Uint8Array },
) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : undefined;
    const headers: Record<string, string> = {};
    if (init.headers) {
      new Headers(init.headers as HeadersInit).forEach((v, k) => (headers[k.toLowerCase()] = v));
    }
    calls.push({ url, method, body, headers });
    const r = spec({ url, method, body });
    return new Response(r.bytes, { status: r.status });
  };
  const credentialStore = new SecretCredentialStore(new MemorySecretBackend());
  const rateLimiter = new RateLimiter(() => 60);
  const httpClient = new HttpClient({ fetchImpl, credentialStore, rateLimiter });
  const adapter = new HDOJAdapter({ httpClient, credentialStore, rateLimiter });
  return { adapter, credentialStore, calls };
}

function gbk(s: string): Uint8Array {
  return new Uint8Array(iconv.encode(s, 'gbk'));
}

test('HDOJ: login() 直接抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, bytes: new Uint8Array(0) }));
  await assert.rejects(
    () => adapter.login(),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('HDOJ: listProblems 解析 JS p() 调用', async () => {
  const html = `
<html><body>
<script>
p(0,1000,-1,"A + B Problem",123,456);
p(1,1001,-1,"Sum Problem",50,500);
</script>
</body></html>
  `;
  const { adapter } = makeAdapter(() => ({ status: 200, bytes: gbk(html) }));
  const list = await adapter.listProblems({ page: 1 });
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, '1000');
  assert.equal(list[0]!.title, 'A + B Problem');
  assert.equal(list[0]!.url, 'http://acm.hdu.edu.cn/showproblem.php?pid=1000');
});

test('HDOJ: getProblem 解析题面与样例', async () => {
  const html = `
<html><body>
<h1>A + B Problem</h1>
<p>Time Limit: 2000/1000 MS (Java/Others) Memory Limit: 65536/32768 K</p>
<div class="panel_title">Problem Description</div>
<div class="panel_content">输入两个整数,输出它们的和。</div>
<div class="panel_title">Input</div>
<div class="panel_content">两个整数 a 和 b。</div>
<div class="panel_title">Output</div>
<div class="panel_content">输出 a + b。</div>
<div class="panel_title">Sample Input</div>
<div class="panel_content"><pre>1 2
3 4</pre></div>
<div class="panel_title">Sample Output</div>
<div class="panel_content"><pre>3
7</pre></div>
</body></html>
  `;
  const { adapter } = makeAdapter(() => ({ status: 200, bytes: gbk(html) }));
  const detail = await adapter.getProblem('1000');
  assert.equal(detail.id, '1000');
  assert.equal(detail.title, 'A + B Problem');
  assert.match(detail.statement, /Problem Description/);
  assert.match(detail.statement, /输入两个整数/);
  assert.equal(detail.samples.length, 1);
  assert.match(detail.samples[0]!.input, /1 2/);
  assert.match(detail.samples[0]!.output, /3/);
  assert.equal(detail.timeLimitMs, 1000);
  assert.equal(detail.memoryLimitKb, 32768);
});

test('HDOJ: getProblem 解析失败抛 PARSE_ERROR', async () => {
  const html = '<html><body><h1>nothing</h1></body></html>';
  const { adapter } = makeAdapter(() => ({ status: 200, bytes: gbk(html) }));
  await assert.rejects(
    () => adapter.getProblem('1000'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'PARSE_ERROR',
  );
});

test('HDOJ: submit GBK 表单提交 + 未登录拒绝', async () => {
  const { adapter, credentialStore, calls } = makeAdapter(({ url }) => {
    if (url.includes('/submit.php')) {
      return { status: 200, bytes: new Uint8Array(0) };
    }
    if (url.includes('/status.php')) {
      // 返回一个 status 表,RunID=12345
      const html = `
<table>
<tr><th>RunID</th><th>?</th><th>Status</th><th>PID</th><th>Time</th><th>Memory</th><th>Length</th><th>Lang</th><th>User</th></tr>
<tr><td>12345</td><td>x</td><td>Queuing</td><td>1000</td><td>0MS</td><td>0K</td><td>10</td><td>G++</td><td>alice</td></tr>
</table>`;
      return { status: 200, bytes: gbk(html) };
    }
    return { status: 200, bytes: new Uint8Array(0) };
  });

  // 未登录拒绝
  await assert.rejects(
    () => adapter.submit('1000', 'cpp', 'int main(){return 0;}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );

  // 登录后提交
  await credentialStore.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc', extra: { username: 'alice' } });
  const sid = await adapter.submit('1000', 'cpp', 'int main(){/*中文*/return 0;}');
  assert.equal(sid, '12345');

  // 验证 submit 调用中 body GBK 编码、charset 头
  const submitCall = calls.find((c) => c.url.includes('/submit.php?action=submit'));
  assert.ok(submitCall);
  assert.match(submitCall!.headers['content-type'] ?? '', /charset=gbk/);
  assert.match(submitCall!.body ?? '', /%D6%D0%CE%C4/); // "中文" 的 GBK URL 编码
});

test('HDOJ: submit 未映射语言抛 LANG_UNSUPPORTED', async () => {
  const { adapter, credentialStore } = makeAdapter(() => ({ status: 200, bytes: new Uint8Array(0) }));
  await credentialStore.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc' });
  await assert.rejects(
    () => adapter.submit('1000', 'go', 'package main'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'LANG_UNSUPPORTED',
  );
});

test('HDOJ: submit GBK 不可编码字符抛 PLATFORM_ERROR', async () => {
  const { adapter, credentialStore } = makeAdapter(({ url }) => {
    if (url.includes('/status.php')) {
      return { status: 200, bytes: gbk('<table></table>') };
    }
    return { status: 200, bytes: new Uint8Array(0) };
  });
  await credentialStore.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc' });
  await assert.rejects(
    () => adapter.submit('1000', 'cpp', 'int main(){/*🚀*/}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'PLATFORM_ERROR',
  );
});

test('HDOJ: pollResult AC', async () => {
  const html = `
<table>
<tr><th>RunID</th></tr>
<tr><td>12345</td><td>x</td><td>Accepted</td><td>1000</td><td>120MS</td><td>1456K</td><td>10</td><td>G++</td><td>alice</td></tr>
</table>`;
  const { adapter, credentialStore } = makeAdapter(() => ({ status: 200, bytes: gbk(html) }));
  await credentialStore.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc', extra: { username: 'alice' } });
  const r = await adapter.pollResult('12345');
  assert.equal(r.verdict, 'AC');
  assert.equal(r.timeMs, 120);
  assert.equal(r.memoryKb, 1456);
});

test('HDOJ: pollResult CE 拉 viewerror', async () => {
  const { adapter, credentialStore } = makeAdapter(({ url }) => {
    if (url.includes('viewerror.php')) {
      return { status: 200, bytes: gbk('<pre>error: missing ;</pre>') };
    }
    const html = `
<table>
<tr><td>12345</td><td>x</td><td>Compilation Error</td><td>1000</td><td>0MS</td><td>0K</td><td>10</td><td>G++</td><td>alice</td></tr>
</table>`;
    return { status: 200, bytes: gbk(html) };
  });
  await credentialStore.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc', extra: { username: 'alice' } });
  const r = await adapter.pollResult('12345');
  assert.equal(r.verdict, 'CE');
  assert.match(r.compileError ?? '', /missing/);
});

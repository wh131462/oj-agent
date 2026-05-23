/**
 * Codeforces 适配器单测：列表 / 题面解析 / Cloudflare 拦截 / 提交 / 轮询。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CodeforcesAdapter } from '../src/platform/codeforces/index.js';
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
  spec: (req: { url: string; method: string; body?: string }) => {
    status: number;
    body: string;
    contentType?: string;
  },
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
    const r = spec({ url, method, body });
    return new Response(r.body, {
      status: r.status,
      headers: { 'content-type': r.contentType ?? 'text/html; charset=utf-8' },
    });
  };
  const credentialStore = new SecretCredentialStore(new MemorySecretBackend());
  const rateLimiter = new RateLimiter(() => 60);
  const httpClient = new HttpClient({ fetchImpl, credentialStore, rateLimiter });
  const adapter = new CodeforcesAdapter({ httpClient, credentialStore, rateLimiter });
  return { adapter, credentialStore, calls };
}

test('CF: login() 直接抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '' }));
  await assert.rejects(
    () => adapter.login(),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('CF: listProblems 调用 problemset.problems 并映射字段', async () => {
  const apiBody = JSON.stringify({
    status: 'OK',
    result: {
      problems: [
        {
          contestId: 1900,
          index: 'A',
          name: 'Cover in Water',
          rating: 800,
          tags: ['greedy', 'implementation'],
        },
        {
          contestId: 1900,
          index: 'B',
          name: 'Roof Construction',
          rating: 1500,
          tags: ['constructive algorithms'],
        },
      ],
      problemStatistics: [],
    },
  });
  const { adapter, calls } = makeAdapter(({ url }) => {
    if (url.includes('problemset.problems'))
      return { status: 200, body: apiBody, contentType: 'application/json' };
    return { status: 404, body: 'not found' };
  });
  const list = await adapter.listProblems({ tags: ['dp'] });
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, '1900A');
  assert.equal(list[0]!.title, 'Cover in Water');
  assert.equal(list[0]!.difficulty, 'Easy');
  assert.deepEqual(list[0]!.tags, ['greedy', 'implementation']);
  assert.match(calls[0]!.url, /tags=dp/);
});

test('CF: listProblems 难度分桶', async () => {
  const apiBody = JSON.stringify({
    status: 'OK',
    result: {
      problems: [
        { contestId: 1, index: 'A', name: 'easy', rating: 800, tags: [] },
        { contestId: 1, index: 'B', name: 'med', rating: 1500, tags: [] },
        { contestId: 1, index: 'C', name: 'hard', rating: 2400, tags: [] },
      ],
      problemStatistics: [],
    },
  });
  const { adapter } = makeAdapter(() => ({
    status: 200,
    body: apiBody,
    contentType: 'application/json',
  }));
  const easy = await adapter.listProblems({ difficulty: 'easy' });
  assert.equal(easy.length, 1);
  assert.equal(easy[0]!.id, '1A');
  const hard = await adapter.listProblems({ difficulty: 'hard' });
  assert.equal(hard.length, 1);
  assert.equal(hard[0]!.id, '1C');
});

const FAKE_PROBLEM_HTML = `
<html><body>
<div class="problem-statement">
  <div class="header">
    <div class="title">A. Cover in Water</div>
    <div class="time-limit"><div class="property-title">time limit per test</div>2 seconds</div>
    <div class="memory-limit"><div class="property-title">memory limit per test</div>256 megabytes</div>
  </div>
  <div><p>Some statement paragraph with <span class="tex-span">$n$</span> variable.</p></div>
  <div class="input-specification">
    <div class="section-title">Input</div>
    <p>integer n.</p>
  </div>
  <div class="output-specification">
    <div class="section-title">Output</div>
    <p>print n.</p>
  </div>
  <div class="sample-tests">
    <div class="sample-test">
      <div class="input"><pre>3\n1 2 3</pre></div>
      <div class="output"><pre>3</pre></div>
    </div>
  </div>
</div>
</body></html>
`;

test('CF: getProblem 解析 .problem-statement 与样例', async () => {
  let problemsetCalls = 0;
  const apiBody = JSON.stringify({
    status: 'OK',
    result: {
      problems: [{ contestId: 1900, index: 'A', name: 'Cover in Water', rating: 800, tags: ['greedy'] }],
      problemStatistics: [],
    },
  });
  const { adapter } = makeAdapter(({ url }) => {
    if (url.includes('problemset.problems')) {
      problemsetCalls++;
      return { status: 200, body: apiBody, contentType: 'application/json' };
    }
    if (url.includes('/contest/1900/problem/A'))
      return { status: 200, body: FAKE_PROBLEM_HTML };
    return { status: 404, body: 'not found' };
  });
  const detail = await adapter.getProblem('1900A');
  assert.equal(detail.platform, 'codeforces');
  assert.equal(detail.id, '1900A');
  assert.equal(detail.title, 'A. Cover in Water');
  assert.equal(detail.timeLimitMs, 2000);
  assert.equal(detail.memoryLimitKb, 256 * 1024);
  assert.equal(detail.samples.length, 1);
  assert.equal(detail.samples[0]!.input, '3\n1 2 3');
  assert.equal(detail.samples[0]!.output, '3');
  assert.match(detail.statement, /## Input/);
  assert.match(detail.statement, /## Output/);
  // metaCache 缺失时会自动拉一次 problemset 做元数据补全
  assert.ok(problemsetCalls >= 1);
});

test('CF: getProblem 命中 Cloudflare 拦截抛 AUTH_REQUIRED', async () => {
  const cloudflareHtml = `<html><body><div class="cf-turnstile" data-sitekey="x"></div>正在进行安全验证</body></html>`;
  const { adapter } = makeAdapter(({ url }) => {
    if (url.includes('/contest/1/problem/A'))
      return { status: 200, body: cloudflareHtml };
    return { status: 200, body: '{}', contentType: 'application/json' };
  });
  await assert.rejects(
    () => adapter.getProblem('1A'),
    (e: Error) =>
      e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('CF: getProblem 无效 ID 抛 NOT_FOUND', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '{}' }));
  await assert.rejects(
    () => adapter.getProblem('foo-bar'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'NOT_FOUND',
  );
});

test('CF: submit 未登录抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '' }));
  await assert.rejects(
    () => adapter.submit('1900A', 'cpp', 'int main(){}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('CF: submit 不支持的语言抛 LANG_UNSUPPORTED', async () => {
  const { adapter, credentialStore } = makeAdapter(() => ({ status: 200, body: '' }));
  await credentialStore.set('codeforces', { platform: 'codeforces', cookie: 'JSESSIONID=abc' });
  await assert.rejects(
    () => adapter.submit('1900A', 'rust', 'fn main(){}'),
    (e: Error) =>
      e instanceof AdapterError && (e as AdapterError).code === 'LANG_UNSUPPORTED',
  );
});

test('CF: submit 已登录走 CSRF 流程并返回 submission id', async () => {
  const submitPageHtml = `<html><meta name="X-Csrf-Token" content="abcdef"><body></body></html>`;
  const userStatusBody = JSON.stringify({
    status: 'OK',
    result: [
      { id: 999, problem: { contestId: 1900, index: 'A' }, verdict: 'TESTING' },
    ],
  });
  const { adapter, credentialStore, calls } = makeAdapter(({ url, method }) => {
    if (url.includes('/contest/1900/submit') && method === 'GET')
      return { status: 200, body: submitPageHtml };
    if (url.includes('/contest/1900/submit') && method === 'POST')
      return { status: 200, body: 'ok' };
    if (url.includes('/api/user.status'))
      return { status: 200, body: userStatusBody, contentType: 'application/json' };
    return { status: 404, body: 'not found' };
  });
  await credentialStore.set('codeforces', {
    platform: 'codeforces',
    cookie: 'JSESSIONID=abc',
    extra: { handle: 'user1' },
  });

  const sid = await adapter.submit('1900A', 'cpp', 'int main(){}');
  assert.equal(sid, '999');
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('submit'));
  assert.ok(post, 'expected POST submit call');
  assert.match(post!.body!, /csrf_token=abcdef/);
  assert.match(post!.body!, /programTypeId=54/);
  assert.match(post!.body!, /submittedProblemIndex=A/);
});

test('CF: pollResult 兜底 ID 返回 UNKNOWN + 提示链接', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '' }));
  const r = await adapter.pollResult('cf:1900:A');
  assert.equal(r.verdict, 'UNKNOWN');
  assert.match(r.message ?? '', /my-submissions/);
});

test('CF: pollResult 通过 user.status 拿到判题结果', async () => {
  let statusCalls = 0;
  const { adapter, credentialStore } = makeAdapter(({ url }) => {
    if (url.includes('/api/user.status')) {
      statusCalls++;
      const body = JSON.stringify({
        status: 'OK',
        result:
          statusCalls === 1
            ? [{ id: 999, verdict: 'TESTING' }]
            : [
                {
                  id: 999,
                  verdict: 'OK',
                  timeConsumedMillis: 100,
                  memoryConsumedBytes: 2048 * 1024,
                  passedTestCount: 10,
                },
              ],
      });
      return { status: 200, body, contentType: 'application/json' };
    }
    return { status: 404, body: 'not found' };
  });
  await credentialStore.set('codeforces', {
    platform: 'codeforces',
    cookie: 'X=1',
    extra: { handle: 'user1' },
  });
  const r = await adapter.pollResult('999');
  assert.equal(r.verdict, 'AC');
  assert.equal(r.timeMs, 100);
  assert.equal(r.memoryKb, 2048);
  assert.equal(r.passedCases, 10);
});

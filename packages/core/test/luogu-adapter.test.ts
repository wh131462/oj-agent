/**
 * 洛谷适配器单测：lentille-context 解析、CSRF 抓取、易盾拦截、提交、轮询。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { LuoguAdapter } from '../src/platform/luogu/index.js';
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
  const adapter = new LuoguAdapter({ httpClient, credentialStore, rateLimiter });
  return { adapter, credentialStore, calls };
}

function wrapLentille(json: object): string {
  const data = JSON.stringify(json);
  return `<!DOCTYPE html><html><head>
  <meta name="csrf-token" content="luogu-csrf-abc">
  <script id="lentille-context" type="application/json">${data}</script>
  </head><body></body></html>`;
}

test('洛谷: login() 直接抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '' }));
  await assert.rejects(
    () => adapter.login(),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('洛谷: listProblems 解析 lentille-context.data.problems.result', async () => {
  const html = wrapLentille({
    data: {
      problems: {
        count: 2,
        result: [
          {
            pid: 'P1001',
            name: 'A+B Problem',
            difficulty: 1,
            tags: [1, 2],
            totalAccepted: 100,
          },
          {
            pid: 'P1002',
            name: '过河卒',
            difficulty: 3,
            tags: [3],
          },
        ],
      },
    },
  });
  const { adapter, calls } = makeAdapter(({ url }) => {
    if (url.includes('/problem/list')) return { status: 200, body: html };
    return { status: 404, body: '' };
  });
  const list = await adapter.listProblems({ page: 1 });
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, 'P1001');
  assert.equal(list[0]!.title, 'A+B Problem');
  assert.equal(list[0]!.difficulty, '入门');
  assert.deepEqual(list[0]!.tags, ['1', '2']);
  assert.equal(list[0]!.url, 'https://www.luogu.com.cn/problem/P1001');
  assert.match(calls[0]!.url, /\?page=1/);
});

test('洛谷: getProblem 解析新版字段并拼装 Markdown', async () => {
  const html = wrapLentille({
    data: {
      problem: {
        pid: 'P1001',
        name: 'A+B Problem',
        difficulty: 1,
        tags: [1],
        description: '输入 $a$、$b$,输出 $a+b$。',
        inputFormat: '两个整数。',
        outputFormat: '它们的和。',
        hint: '注意溢出。',
        samples: [['1 2', '3']],
        limits: { time: [1000], memory: [125 * 1024] },
      },
    },
  });
  const { adapter } = makeAdapter(() => ({ status: 200, body: html }));
  const detail = await adapter.getProblem('P1001');
  assert.equal(detail.id, 'P1001');
  assert.equal(detail.title, 'A+B Problem');
  assert.equal(detail.difficulty, '入门');
  assert.match(detail.statement, /## 题目描述/);
  assert.match(detail.statement, /\$a\+b\$/);
  assert.equal(detail.samples.length, 1);
  assert.equal(detail.samples[0]!.input, '1 2');
  assert.equal(detail.samples[0]!.output, '3');
  assert.equal(detail.timeLimitMs, 1000);
  assert.equal(detail.memoryLimitKb, 125 * 1024);
});

test('洛谷: getProblem 回落到旧版 contenu.content', async () => {
  const html = wrapLentille({
    data: {
      problem: {
        pid: 'P1002',
        name: '过河卒',
        difficulty: 3,
        contenu: { content: '## 题目内容\n\n旧版 Markdown。' },
      },
    },
  });
  const { adapter } = makeAdapter(() => ({ status: 200, body: html }));
  const detail = await adapter.getProblem('P1002');
  assert.match(detail.statement, /旧版 Markdown/);
});

test('洛谷: getProblem 页面缺少 lentille-context 抛 PARSE_ERROR', async () => {
  const { adapter } = makeAdapter(() => ({
    status: 200,
    body: '<html><body>nothing here</body></html>',
  }));
  await assert.rejects(
    () => adapter.getProblem('P1001'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'PARSE_ERROR',
  );
});

test('洛谷: 命中易盾验证抛 AUTH_REQUIRED', async () => {
  const html = `<html><body><script src="https://cstaticdun.126.net/load.min.js"></script>网易易盾验证中</body></html>`;
  const { adapter } = makeAdapter(() => ({ status: 200, body: html }));
  await assert.rejects(
    () => adapter.listProblems({ page: 1 }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('洛谷: submit 未登录抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '' }));
  await assert.rejects(
    () => adapter.submit('P1001', 'cpp', 'int main(){}'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('洛谷: submit 不支持语言抛 LANG_UNSUPPORTED', async () => {
  const { adapter, credentialStore } = makeAdapter(() => ({
    status: 200,
    body: '',
  }));
  await credentialStore.set('luogu', { platform: 'luogu', cookie: '_uid=1' });
  await assert.rejects(
    () => adapter.submit('P1001', 'rust', 'fn main(){}'),
    (e: Error) =>
      e instanceof AdapterError && (e as AdapterError).code === 'LANG_UNSUPPORTED',
  );
});

test('洛谷: submit 已登录走 CSRF 流程并返回 rid', async () => {
  const detailHtml = wrapLentille({
    data: {
      problem: { pid: 'P1001', name: 'A+B', difficulty: 1, description: 'x' },
    },
  });
  const submitBody = JSON.stringify({ rid: 12345 });
  const { adapter, credentialStore, calls } = makeAdapter(({ url, method }) => {
    if (url.includes('/problem/P1001') && method === 'GET')
      return { status: 200, body: detailHtml };
    if (url.includes('/fe/api/problem/submit/P1001') && method === 'POST')
      return { status: 200, body: submitBody, contentType: 'application/json' };
    return { status: 404, body: '' };
  });
  await credentialStore.set('luogu', { platform: 'luogu', cookie: '_uid=1' });
  const rid = await adapter.submit('P1001', 'cpp', 'int main(){}');
  assert.equal(rid, '12345');
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('submit/P1001'));
  assert.ok(post, 'expected POST submit');
  assert.equal(post!.headers['x-csrf-token'], 'luogu-csrf-abc');
  const json = JSON.parse(post!.body!);
  assert.equal(json.lang, 4);
  assert.equal(json.code, 'int main(){}');
});

test('洛谷: pollResult 拿到完成态返回 AC', async () => {
  let calls = 0;
  const acHtml = wrapLentille({
    data: {
      record: {
        status: 7,
        time: 12,
        memory: 2048,
        detail: { compileResult: { success: true } },
      },
    },
  });
  const judgingHtml = wrapLentille({ data: { record: { status: 1 } } });
  const { adapter } = makeAdapter(() => {
    calls++;
    return { status: 200, body: calls === 1 ? judgingHtml : acHtml };
  });
  const r = await adapter.pollResult('12345');
  assert.equal(r.verdict, 'AC');
  assert.equal(r.timeMs, 12);
  assert.equal(r.memoryKb, 2048);
});

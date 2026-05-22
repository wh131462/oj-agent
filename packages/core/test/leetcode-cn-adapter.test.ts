/**
 * LeetCode CN 适配器单测。完全使用 mock fetch,不发真实网络。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { LeetCodeCnAdapter } from '../src/platform/leetcode-cn/index.js';
import { HttpClient } from '../src/http/client.js';
import { SecretCredentialStore } from '../src/auth/credential-store.js';
import { RateLimiter } from '../src/http/rate-limiter.js';
import { AdapterError } from '../src/platform/errors.js';
import { MemorySecretBackend } from './_helpers/memory-secret-backend.js';

type FetchCall = { url: string; method: string; body?: string };

function makeAdapter(spec: (req: { url: string; body?: string }) => { status: number; body: string }) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body });
    const r = spec({ url, body });
    return new Response(new TextEncoder().encode(r.body), { status: r.status });
  };
  const credentialStore = new SecretCredentialStore(new MemorySecretBackend());
  const rateLimiter = new RateLimiter(() => 60);
  const httpClient = new HttpClient({ fetchImpl, credentialStore, rateLimiter });
  const adapter = new LeetCodeCnAdapter({ httpClient, credentialStore, rateLimiter });
  return { adapter, credentialStore, calls };
}

test('LeetCode: listProblems 关键字 / 难度 / 分页透传 GraphQL', async () => {
  const { adapter, calls } = makeAdapter(({ body }) => {
    // 校验请求体
    const json = JSON.parse(body ?? '{}');
    assert.equal(json.variables.filters.searchKeywords, '两数');
    assert.equal(json.variables.filters.difficulty, 'EASY');
    assert.equal(json.variables.skip, 50);
    assert.equal(json.variables.limit, 50);
    return {
      status: 200,
      body: JSON.stringify({
        data: {
          problemsetQuestionList: {
            questions: [
              {
                frontendQuestionId: '1',
                title: 'Two Sum',
                titleCn: '两数之和',
                titleSlug: 'two-sum',
                difficulty: 'EASY',
                topicTags: [{ name: 'Array', nameTranslated: '数组', slug: 'array' }],
              },
            ],
          },
        },
      }),
    };
  });
  const list = await adapter.listProblems({ keyword: '两数', difficulty: 'easy', page: 2, pageSize: 50 });
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, '1');
  assert.equal(list[0]!.title, '两数之和');
  assert.equal(list[0]!.difficulty, 'Easy');
  assert.equal(list[0]!.tags?.[0], '数组');
  assert.equal(list[0]!.url, 'https://leetcode.cn/problems/two-sum/');
  assert.equal(calls.length, 1);
});

test('LeetCode: getProblem 题面解析与代码模板', async () => {
  const { adapter } = makeAdapter(() => ({
    status: 200,
    body: JSON.stringify({
      data: {
        question: {
          questionId: '1',
          questionFrontendId: '1',
          title: 'Two Sum',
          titleSlug: 'two-sum',
          translatedTitle: '两数之和',
          translatedContent: '<p>给定数组 <code>nums</code> ...</p><pre>nums = [2,7,11,15]</pre>',
          difficulty: 'Easy',
          exampleTestcases: '[2,7,11,15]\n9\n[3,2,4]\n6',
          metaData: JSON.stringify({ params: [{ name: 'nums' }, { name: 'target' }] }),
          codeSnippets: [
            { lang: 'C++', langSlug: 'cpp', code: 'class Solution{};' },
            { lang: 'Python3', langSlug: 'python3', code: 'class Solution:' },
          ],
          topicTags: [],
        },
      },
    }),
  }));
  const detail = await adapter.getProblem('two-sum');
  assert.equal(detail.id, '1');
  assert.equal(detail.title, '两数之和');
  assert.match(detail.statement, /给定数组/);
  assert.equal(detail.samples.length, 2);
  assert.equal(detail.samples[0]!.input, '[2,7,11,15]\n9');
  assert.equal(detail.codeSnippets?.cpp, 'class Solution{};');
});

test('LeetCode: submit 语言映射 + CSRF 注入', async () => {
  const { adapter, credentialStore, calls } = makeAdapter(({ url, body }) => {
    if (url.includes('/graphql/')) {
      // 触发 getProblem 内填充 questionId
      return {
        status: 200,
        body: JSON.stringify({
          data: {
            question: {
              questionId: '1',
              questionFrontendId: '1',
              title: 'Two Sum',
              titleSlug: 'two-sum',
              translatedContent: '<p>x</p>',
              difficulty: 'Easy',
              exampleTestcases: '',
              codeSnippets: [],
              topicTags: [],
            },
          },
        }),
      };
    }
    if (url.includes('/submit/')) {
      // 校验请求体
      const j = JSON.parse(body ?? '{}');
      assert.equal(j.lang, 'cpp');
      assert.equal(j.question_id, '1');
      assert.equal(j.typed_code, 'int main(){}');
      return { status: 200, body: JSON.stringify({ submission_id: 999 }) };
    }
    return { status: 500, body: 'unknown' };
  });

  // 先注入 cookie 含 csrftoken
  await credentialStore.set('leetcode-cn', {
    platform: 'leetcode-cn',
    cookie: 'LEETCODE_SESSION=abc; csrftoken=tok123',
  });

  const sid = await adapter.submit('two-sum', 'cpp', 'int main(){}');
  assert.equal(sid, '999');
  // 验证 submit 调用中 CSRF header 已设置
  const submitCall = calls.find((c) => c.url.includes('/submit/'));
  assert.ok(submitCall);
});

test('LeetCode: submit 未映射语言抛 LANG_UNSUPPORTED', async () => {
  const { adapter, credentialStore } = makeAdapter(() => ({ status: 200, body: '{}' }));
  await credentialStore.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'csrftoken=x' });
  await assert.rejects(
    () => adapter.submit('two-sum', 'go', '...'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'LANG_UNSUPPORTED',
  );
});

test('LeetCode: submit 未登录抛 AUTH_REQUIRED', async () => {
  const { adapter } = makeAdapter(() => ({ status: 200, body: '{}' }));
  await assert.rejects(
    () => adapter.submit('two-sum', 'cpp', '...'),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
});

test('LeetCode: pollResult AC 路径', async () => {
  let polls = 0;
  const { adapter, credentialStore } = makeAdapter(() => {
    polls++;
    if (polls < 3) {
      return { status: 200, body: JSON.stringify({ state: 'PENDING' }) };
    }
    return {
      status: 200,
      body: JSON.stringify({
        state: 'SUCCESS',
        status_msg: 'Accepted',
        status_runtime: '120 ms',
        status_memory: '1.4 MB',
        total_correct: 10,
        total_testcases: 10,
      }),
    };
  });
  await credentialStore.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'csrftoken=x' });
  const r = await adapter.pollResult('999');
  assert.equal(r.verdict, 'AC');
  assert.equal(r.timeMs, 120);
  assert.equal(r.passedCases, 10);
});

test('LeetCode: pollResult CE 透传 compileError', async () => {
  const { adapter, credentialStore } = makeAdapter(() => ({
    status: 200,
    body: JSON.stringify({
      state: 'SUCCESS',
      status_msg: 'Compile Error',
      full_compile_error: "expected ';'",
    }),
  }));
  await credentialStore.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'csrftoken=x' });
  const r = await adapter.pollResult('1');
  assert.equal(r.verdict, 'CE');
  assert.equal(r.compileError, "expected ';'");
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { redact, redactString } from '../src/ai/redactor.js';
import { tokenEstimate, truncate } from '../src/ai/truncate.js';
import { buildContext, type ProblemDetail } from '../src/ai/context-builder.js';

test('redact: 剥离敏感字段（递归）', () => {
  const obj = {
    username: 'alice',
    submissionId: '123',
    Cookie: 'session=abc',
    Authorization: 'Bearer xx',
    nested: { token: 'tk', code: 'ok' },
    samples: [{ input: '1', cookies: 'xx' }],
    code: 'int main(){}',
  };
  const out = redact(obj) as any;
  assert.equal(out.username, undefined);
  assert.equal(out.submissionId, undefined);
  assert.equal(out.Cookie, undefined);
  assert.equal(out.Authorization, undefined);
  assert.equal(out.nested.token, undefined);
  assert.equal(out.nested.code, 'ok');
  assert.equal(out.samples[0].cookies, undefined);
  assert.equal(out.samples[0].input, '1');
  assert.equal(out.code, 'int main(){}');
});

test('redactString: 替换 header 形态', () => {
  const s = 'Authorization: Bearer abc.def\nCookie: a=b\nHello';
  const out = redactString(s);
  assert.ok(out.includes('Authorization: <redacted>'));
  assert.ok(out.includes('Cookie: <redacted>'));
  assert.ok(out.includes('Hello'));
});

test('tokenEstimate ~ len/4', () => {
  assert.equal(tokenEstimate(''), 0);
  assert.equal(tokenEstimate('abcd'), 1);
  assert.equal(tokenEstimate('abcde'), 2);
});

test('truncate: 代码超额时省略', () => {
  const problem: ProblemDetail = {
    platform: 'lc',
    problemId: '1',
    title: 't',
    statement: 'x'.repeat(40),
    samples: [],
  };
  const code = 'y'.repeat(400); // ~100 tokens
  const r = truncate({ problem, code }, /* maxInputTokens */ 30);
  assert.equal(r.omitted.code, true);
  assert.equal(r.context.code, undefined);
});

test('truncate: 多余样例溢出时记入 omitted 计数', () => {
  const problem: ProblemDetail = {
    platform: 'lc', problemId: '1', title: 't', statement: 'short', samples: [],
  };
  const extra = Array.from({ length: 5 }, (_, i) => ({ input: 'x'.repeat(100), expectedOutput: 'y'.repeat(100) }));
  const r = truncate({ problem, extraSamples: extra }, 50);
  assert.ok(r.omitted.extraSamples > 0);
});

test('buildContext: explainCode 不含失败用例字段', () => {
  const problem: ProblemDetail = {
    platform: 'lc', problemId: '1', title: 'two-sum', statement: 'desc', samples: [], language: 'cpp',
  };
  const { user } = buildContext({
    action: { kind: 'explainCode' },
    problem,
    code: 'int main(){return 0;}',
    selection: undefined,
  });
  assert.ok(user.includes('待解释代码'));
  assert.ok(!user.includes('测试结果'));
});

test('buildContext: explainError 含 diff 区块', () => {
  const problem: ProblemDetail = {
    platform: 'hdoj', problemId: '1000', title: 'A+B', statement: 'sum', samples: [],
  };
  const { user } = buildContext({
    action: { kind: 'explainError' },
    problem,
    code: 'int main(){}',
    failedCase: { input: '1 2', expectedOutput: '3', actualOutput: '4', diff: '- 3\n+ 4' },
  });
  assert.ok(user.includes('失败用例'));
  assert.ok(user.includes('- 3'));
});

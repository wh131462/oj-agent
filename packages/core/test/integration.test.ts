import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RateLimiter } from '../src/http/rate-limiter.js';
import { AIRunner } from '../src/ai/runner.js';
import type { AIChunk, AIProfile } from '../src/ai/types.js';

function sseBody(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(text));
      c.close();
    },
  });
}

function collect(s: AsyncIterable<AIChunk>): Promise<AIChunk[]> {
  return (async () => {
    const out: AIChunk[] = [];
    for await (const c of s) out.push(c);
    return out;
  })();
}

const limiter = new RateLimiter(() => 100);

test('integration: OpenAI 全链路 — explainError 流式 + 脱敏', async () => {
  let capturedBody: any = null;
  let capturedHeaders: Record<string, string> = {};
  const fakeFetch = (async (url: string, init: RequestInit) => {
    capturedBody = JSON.parse(init.body as string);
    capturedHeaders = init.headers as Record<string, string>;
    return new Response(
      sseBody(
        'data: {"choices":[{"delta":{"content":"故障"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"原因"}}]}\n\n' +
          'data: [DONE]\n\n',
      ),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const runner = new AIRunner(limiter, fakeFetch);
  const profile: AIProfile = { id: 'p', label: 'p', provider: 'openai', model: 'gpt-4o' };
  const chunks = await collect(
    runner.run({
      profile,
      apiKey: 'sk-real',
      system: 'sys',
      user: 'Authorization: Bearer LEAK\nCookie: a=b\nplease help',
      signal: new AbortController().signal,
      redactEnabled: true,
    }),
  );

  const text = chunks.filter((c) => c.type === 'text').map((c) => c.text).join('');
  assert.equal(text, '故障原因');
  assert.equal(capturedHeaders['authorization'], 'Bearer sk-real');

  // 脱敏校验：发出去的 messages 中不应包含原始 Bearer LEAK / Cookie 值
  const flat = JSON.stringify(capturedBody);
  assert.equal(flat.includes('LEAK'), false, '不应将原始 Bearer 内容外发');
  assert.equal(flat.includes('a=b'), false, '不应将原始 Cookie 内容外发');
  assert.ok(flat.includes('<redacted>'));
});

test('integration: Anthropic 全链路 + abort 中断', async () => {
  let aborted = false;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const sig = init.signal as AbortSignal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
          ),
        );
        sig.addEventListener('abort', () => {
          aborted = true;
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;

  const runner = new AIRunner(limiter, fakeFetch);
  const profile: AIProfile = { id: 'p', label: 'p', provider: 'anthropic', model: 'claude-sonnet-4-6' };
  const ctl = new AbortController();
  const iter = runner.run({
    profile,
    apiKey: 'sk-ant',
    system: '',
    user: 'q',
    signal: ctl.signal,
  });
  const got: AIChunk[] = [];
  setTimeout(() => ctl.abort(), 30);
  const start = Date.now();
  for await (const c of iter) {
    got.push(c);
    if (Date.now() - start > 1000) break;
  }
  assert.equal(got[0]?.text, 'hi');
  assert.ok(Date.now() - start < 1000);
  assert.equal(aborted, true);
});

test('integration: 401 → error chunk', async () => {
  const fakeFetch = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
  const runner = new AIRunner(limiter, fakeFetch);
  const profile: AIProfile = { id: 'p', label: 'p', provider: 'openai', model: 'gpt-4o' };
  const chunks = await collect(
    runner.run({ profile, apiKey: 'sk', system: '', user: 'x', signal: new AbortController().signal }),
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].type, 'error');
  assert.equal(chunks[0].error?.httpStatus, 401);
});

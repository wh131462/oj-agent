import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { OpenAIAdapter } from '../src/ai/openai-adapter.js';
import { AnthropicAdapter } from '../src/ai/anthropic-adapter.js';
import { createAdapter } from '../src/ai/factory.js';
import type { AIChunk, AIProfile } from '../src/ai/types.js';

function bodyFromString(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(text));
      controller.close();
    },
  });
}

function bodyFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i++]));
    },
  });
}

function mockFetch(response: Response): typeof fetch {
  return ((..._args: unknown[]) => Promise.resolve(response)) as unknown as typeof fetch;
}

async function collect(stream: AsyncIterable<AIChunk>): Promise<AIChunk[]> {
  const out: AIChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

const openaiProfile: AIProfile = {
  id: 'p',
  label: 'p',
  provider: 'openai',
  model: 'gpt-4o',
};

const anthropicProfile: AIProfile = {
  id: 'p',
  label: 'p',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
};

test('OpenAI: 解析多 chunk 流并识别 [DONE]', async () => {
  const sse =
    'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
    ': keepalive\n\n' +
    'data: [DONE]\n\n';
  const resp = new Response(bodyFromString(sse), { status: 200 });
  const adapter = new OpenAIAdapter(openaiProfile, 'sk-x', mockFetch(resp));
  const chunks = await collect(adapter.stream([{ role: 'user', content: 'hi' }], undefined, {}, new AbortController().signal));
  assert.deepEqual(
    chunks.map((c) => c.text ?? c.type),
    ['hello', ' world', 'done'],
  );
});

test('OpenAI: 跳过非法 JSON chunk 不中断整流', async () => {
  const sse =
    'data: not-json\n\n' +
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
    'data: [DONE]\n\n';
  const resp = new Response(bodyFromString(sse), { status: 200 });
  const adapter = new OpenAIAdapter(openaiProfile, 'sk-x', mockFetch(resp));
  const chunks = await collect(adapter.stream([{ role: 'user', content: 'hi' }], undefined, {}, new AbortController().signal));
  assert.equal(chunks.filter((c) => c.type === 'text').length, 1);
  assert.equal(chunks.find((c) => c.type === 'text')?.text, 'ok');
});

test('OpenAI: 非 200 返回 error chunk', async () => {
  const resp = new Response('unauthorized', { status: 401 });
  const adapter = new OpenAIAdapter(openaiProfile, 'sk-x', mockFetch(resp));
  const chunks = await collect(adapter.stream([{ role: 'user', content: 'hi' }], undefined, {}, new AbortController().signal));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].type, 'error');
  assert.equal(chunks[0].error?.httpStatus, 401);
});

test('Anthropic: 解析 content_block_delta 与 message_stop', async () => {
  const sse =
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"foo"}}\n\n' +
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"bar"}}\n\n' +
    'event: message_stop\n' +
    'data: {"type":"message_stop"}\n\n';
  const resp = new Response(bodyFromString(sse), { status: 200 });
  const adapter = new AnthropicAdapter(anthropicProfile, 'sk-ant', mockFetch(resp));
  const chunks = await collect(
    adapter.stream([{ role: 'user', content: 'hi' }], 'system!', {}, new AbortController().signal),
  );
  assert.deepEqual(
    chunks.map((c) => c.text ?? c.type),
    ['foo', 'bar', 'done'],
  );
});

test('Anthropic: 跨 fetch chunk 边界拼接事件', async () => {
  const part1 =
    'event: content_block_delta\n' +
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hel';
  const part2 =
    'lo"}}\n\n' +
    'event: message_stop\n' +
    'data: {"type":"message_stop"}\n\n';
  const resp = new Response(bodyFromChunks([part1, part2]), { status: 200 });
  const adapter = new AnthropicAdapter(anthropicProfile, 'sk-ant', mockFetch(resp));
  const chunks = await collect(adapter.stream([{ role: 'user', content: 'hi' }], undefined, {}, new AbortController().signal));
  const text = chunks
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
  assert.equal(text, 'hello');
});

test('createAdapter: provider 字段选择适配器', () => {
  const a = createAdapter(openaiProfile, 'k');
  const b = createAdapter(anthropicProfile, 'k');
  assert.equal(a.provider, 'openai');
  assert.equal(b.provider, 'anthropic');
});

test('abort: signal abort 立即结束流', async () => {
  // 永不结束的流
  const body = new ReadableStream<Uint8Array>({
    pull() {
      /* never close */
    },
  });
  const resp = new Response(body, { status: 200 });
  const adapter = new OpenAIAdapter(openaiProfile, 'sk-x', mockFetch(resp));
  const ctl = new AbortController();
  const iter = adapter.stream([{ role: 'user', content: 'hi' }], undefined, {}, ctl.signal);

  setTimeout(() => ctl.abort(), 20);

  const collected: AIChunk[] = [];
  const start = Date.now();
  for await (const c of iter) {
    collected.push(c);
    if (Date.now() - start > 1000) break;
  }
  // abort 应在 <1s 内退出循环
  assert.ok(Date.now() - start < 1000);
});

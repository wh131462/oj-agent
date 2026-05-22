import type { AIChunk } from './types.js';

/**
 * 通用 SSE 行解析。逐字节积累 stream chunk 后按双换行拆事件，按行抽 field:value。
 * 宽容设计：忽略空行、`:` 起首注释行、非法 JSON。
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const ev = parseEventBlock(raw);
        if (ev) yield ev;
      }
    }
    if (buffer.trim().length > 0) {
      const ev = parseEventBlock(buffer);
      if (ev) yield ev;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function parseEventBlock(raw: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

export function safeJSONParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function errorChunk(message: string, httpStatus?: number): AIChunk {
  return { type: 'error', error: { message, httpStatus } };
}

import type {
  AIChunk,
  AIMessage,
  AIProfile,
  AIProviderAdapter,
  AIRequestOptions,
} from './types.js';
import { errorChunk, parseSSEStream, safeJSONParse } from './sse.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_VERSION = '2023-06-01';

export class AnthropicAdapter implements AIProviderAdapter {
  readonly provider = 'anthropic' as const;

  constructor(
    private readonly profile: AIProfile,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async *stream(
    messages: AIMessage[],
    system: string | undefined,
    opts: AIRequestOptions,
    signal: AbortSignal,
  ): AsyncIterable<AIChunk> {
    const base = (this.profile.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const url = `${base}/v1/messages`;

    const filtered = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: this.profile.model,
      messages: filtered,
      temperature: opts.temperature ?? this.profile.temperature ?? 0.2,
      max_tokens: opts.maxOutputTokens ?? this.profile.maxOutputTokens ?? 2048,
      stream: true,
    };
    if (system && system.trim().length > 0) body.system = system;

    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.profile.anthropicVersion ?? DEFAULT_VERSION,
          accept: 'text/event-stream',
          ...(this.profile.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      yield errorChunk(e instanceof Error ? e.message : String(e));
      return;
    }

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      yield errorChunk(text || resp.statusText, resp.status);
      return;
    }

    for await (const ev of parseSSEStream(resp.body, signal)) {
      const json = safeJSONParse<{
        type?: string;
        delta?: { type?: string; text?: string };
        error?: { message?: string };
      }>(ev.data);
      if (!json) continue;
      if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
        const piece = json.delta.text;
        if (typeof piece === 'string' && piece.length > 0) {
          yield { type: 'text', text: piece };
        }
      } else if (json.type === 'message_stop') {
        yield { type: 'done' };
        return;
      } else if (json.type === 'error') {
        yield errorChunk(json.error?.message ?? 'anthropic stream error');
        return;
      }
    }
    yield { type: 'done' };
  }
}

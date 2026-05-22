import type {
  AIChunk,
  AIMessage,
  AIProfile,
  AIProviderAdapter,
  AIRequestOptions,
} from './types.js';
import { errorChunk, parseSSEStream, safeJSONParse } from './sse.js';

const DEFAULT_BASE_URL = 'https://api.openai.com';

export class OpenAIAdapter implements AIProviderAdapter {
  readonly provider = 'openai' as const;

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
    const url = `${base}/v1/chat/completions`;

    const merged: AIMessage[] = system
      ? [{ role: 'system', content: system }, ...messages]
      : messages;

    const body = {
      model: this.profile.model,
      messages: merged.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts.temperature ?? this.profile.temperature ?? 0.2,
      max_tokens: opts.maxOutputTokens ?? this.profile.maxOutputTokens ?? 2048,
      stream: true,
    };

    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
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
      if (ev.data === '[DONE]') {
        yield { type: 'done' };
        return;
      }
      const json = safeJSONParse<{
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
      }>(ev.data);
      if (!json) continue;
      const choice = json.choices?.[0];
      const piece = choice?.delta?.content;
      if (typeof piece === 'string' && piece.length > 0) {
        yield { type: 'text', text: piece };
      }
      if (choice?.finish_reason && choice.finish_reason !== null) {
        yield { type: 'done' };
        return;
      }
    }
    yield { type: 'done' };
  }
}

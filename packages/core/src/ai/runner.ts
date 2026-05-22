import { createAdapter } from './factory.js';
import { redact, redactString } from './redactor.js';
import type { AIChunk, AIMessage, AIProfile } from './types.js';
import type { RateLimiter } from '../http/rate-limiter.js';

export interface AIRunInput {
  profile: AIProfile;
  apiKey: string;
  system: string;
  user: string;
  signal: AbortSignal;
  /** 默认 true: 对 system+user 文本与 extraHeaders 做模式脱敏。 */
  redactEnabled?: boolean;
}

export class AIRunner {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async *run(input: AIRunInput): AsyncIterable<AIChunk> {
    this.limiter.tryConsume('ai');

    const redactEnabled = input.redactEnabled !== false;
    const system = redactEnabled ? redactString(input.system) : input.system;
    const user = redactEnabled ? redactString(input.user) : input.user;
    const profile = redactEnabled
      ? { ...input.profile, extraHeaders: redact(input.profile.extraHeaders ?? {}) }
      : input.profile;

    const adapter = createAdapter(profile, input.apiKey, this.fetchImpl);
    const messages: AIMessage[] = [{ role: 'user', content: user }];
    yield* adapter.stream(messages, system, {
      temperature: profile.temperature,
      maxOutputTokens: profile.maxOutputTokens,
      timeoutMs: profile.requestTimeoutMs,
    }, input.signal);
  }
}

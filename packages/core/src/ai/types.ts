export type AIProvider = 'openai' | 'anthropic';

export interface AIProfile {
  id: string;
  label: string;
  provider: AIProvider;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxInputTokens?: number;
  requestTimeoutMs?: number;
  anthropicVersion?: string;
  extraHeaders?: Record<string, string>;
}

export type AIMessageRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  role: AIMessageRole;
  content: string;
}

export type AIChunkType = 'text' | 'done' | 'error';

export interface AIChunk {
  type: AIChunkType;
  text?: string;
  error?: {
    httpStatus?: number;
    message: string;
  };
}

export interface AIRequestOptions {
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface AIProviderAdapter {
  readonly provider: AIProvider;
  stream(
    messages: AIMessage[],
    system: string | undefined,
    opts: AIRequestOptions,
    signal: AbortSignal,
  ): AsyncIterable<AIChunk>;
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`AI 请求超出速率限制，请在 ${retryAfterSeconds} 秒后重试`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

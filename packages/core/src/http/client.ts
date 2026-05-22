/**
 * 公共 HTTP 客户端。所有平台适配器必须通过本类出网,
 * MUST NOT 直接调用 `fetch / undici / axios`。
 *
 * 能力:
 * - 限速(RateLimiter)
 * - GBK 双向编解码
 * - Cookie 注入(从 CredentialStore 按平台读取)
 * - 超时(timeoutMs + AbortSignal 合并)
 * - 幂等重试(GET/HEAD,5xx + 网络错按指数退避)
 * - 代理透传(undici.ProxyAgent)
 * - 错误归一化(HTTP 状态码 -> AdapterError)
 */

import type { Dispatcher } from 'undici';
import type { RateLimiter } from './rate-limiter.js';
import { AdapterError, fromHttpStatus } from '../platform/errors.js';
import type { PlatformId, PlatformCredential } from '../platform/adapter.js';
import { decodeBody, encodeForm, type SupportedEncoding } from './encoding.js';
import { RateLimitError } from '../ai/types.js';

export interface CredentialReader {
  get(platform: PlatformId): Promise<PlatformCredential | undefined>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'PATCH';

export interface HttpRequest {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: string | Record<string, unknown>;
  contentType?: 'json' | 'form' | 'raw';
  formEncoding?: SupportedEncoding;
  responseEncoding?: SupportedEncoding;
  timeoutMs?: number;
  retry?: { attempts: number; baseDelayMs?: number };
  injectCookieFor?: PlatformId;
  rateLimitKey?: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json<T = unknown>(): T;
}

export interface HttpClientOptions {
  credentialStore?: CredentialReader;
  rateLimiter?: RateLimiter;
  proxyUrl?: string;
  /** 注入 fetch / dispatcher,主要用于测试。 */
  fetchImpl?: typeof fetch;
  /** 注入 ProxyAgent 构造函数,主要用于测试或 lazy import。 */
  proxyAgentFactory?: (url: string) => Dispatcher;
  /** 默认超时(ms)。 */
  defaultTimeoutMs?: number;
}

export class HttpClient {
  private readonly credentialStore?: CredentialReader;
  private readonly rateLimiter?: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;
  private dispatcher?: Dispatcher;
  private readonly proxyUrl?: string;
  private readonly proxyAgentFactory?: (url: string) => Dispatcher;

  constructor(opts: HttpClientOptions = {}) {
    this.credentialStore = opts.credentialStore;
    this.rateLimiter = opts.rateLimiter;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 15_000;
    this.proxyUrl = opts.proxyUrl;
    this.proxyAgentFactory = opts.proxyAgentFactory;
  }

  private async getDispatcher(): Promise<Dispatcher | undefined> {
    if (!this.proxyUrl) return undefined;
    if (this.dispatcher) return this.dispatcher;
    if (this.proxyAgentFactory) {
      this.dispatcher = this.proxyAgentFactory(this.proxyUrl);
    } else {
      const undici = await import('undici');
      this.dispatcher = new undici.ProxyAgent(this.proxyUrl);
    }
    return this.dispatcher;
  }

  async request(options: HttpRequest): Promise<HttpResponse> {
    const method = (options.method ?? 'GET').toUpperCase() as HttpMethod;
    const url = buildUrl(options.url, options.query);
    const responseEncoding = options.responseEncoding ?? 'utf-8';

    // 限速
    const bucket = options.rateLimitKey ?? options.injectCookieFor;
    if (bucket && this.rateLimiter) {
      try {
        this.rateLimiter.tryConsume(bucket);
      } catch (e) {
        if (e instanceof RateLimitError) {
          throw new AdapterError(
            'RATE_LIMITED',
            `平台 ${bucket} 已超过限速,请在 ${e.retryAfterSeconds}s 后重试`,
            true,
            e,
          );
        }
        throw e;
      }
    }

    // headers
    const headers: Record<string, string> = { ...(options.headers ?? {}) };

    // Cookie 注入
    if (options.injectCookieFor && this.credentialStore) {
      const cred = await this.credentialStore.get(options.injectCookieFor);
      if (cred?.cookie) {
        headers['Cookie'] = cred.cookie;
      }
    }

    // body 序列化
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      const ct = options.contentType ?? (typeof options.body === 'string' ? 'raw' : 'json');
      if (ct === 'json') {
        body = JSON.stringify(options.body);
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      } else if (ct === 'form') {
        if (typeof options.body !== 'object' || options.body === null) {
          throw new Error('contentType=form 时 body 必须是对象');
        }
        const formEncoding = options.formEncoding ?? 'utf-8';
        try {
          body = await encodeForm(
            options.body as Record<string, string | number | boolean>,
            formEncoding,
          );
        } catch (e) {
          throw new AdapterError(
            'PLATFORM_ERROR',
            (e as Error).message,
            false,
            e,
          );
        }
        const ctHeader =
          formEncoding === 'gbk'
            ? 'application/x-www-form-urlencoded; charset=gbk'
            : 'application/x-www-form-urlencoded';
        if (!headers['Content-Type']) headers['Content-Type'] = ctHeader;
      } else {
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      }
    }

    // 超时与 signal 合并
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const retryConfig = options.retry;
    const maxAttempts = retryConfig?.attempts ?? 0;
    const allowRetry = method === 'GET' || method === 'HEAD';
    const baseDelay = retryConfig?.baseDelayMs ?? 500;

    let attempt = 0;
    let lastError: unknown;
    // 总尝试次数 = 1(首次) + maxAttempts(仅 GET/HEAD)
    const totalAttempts = allowRetry ? 1 + Math.max(0, maxAttempts) : 1;
    while (attempt < totalAttempts) {
      // 每次新建 AbortController 与外部 signal 合并
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort(options.signal!.reason);
      if (options.signal) {
        if (options.signal.aborted) {
          throw new AdapterError(
            'NETWORK_ERROR',
            'request aborted',
            false,
            options.signal.reason,
          );
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
      const timer = setTimeout(() => ctrl.abort(new Error('TIMEOUT')), timeoutMs);

      try {
        const dispatcher = await this.getDispatcher();
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: ctrl.signal,
          // @ts-expect-error undici 扩展字段
          dispatcher,
        });

        const buf = await res.arrayBuffer();
        const text = await decodeBody(buf, responseEncoding);
        const respHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => (respHeaders[k] = v));

        // 非 2xx 处理
        if (res.status >= 400) {
          // 5xx + GET/HEAD 触发重试,否则归一化抛错
          if (allowRetry && res.status >= 500 && attempt + 1 < totalAttempts) {
            attempt++;
            await sleepBackoff(baseDelay, attempt);
            continue;
          }
          const { code, retriable } = fromHttpStatus(res.status);
          throw new AdapterError(
            code,
            `HTTP ${res.status}: ${text.slice(0, 200)}`,
            retriable,
          );
        }

        return {
          status: res.status,
          headers: respHeaders,
          text,
          json<T = unknown>() {
            return JSON.parse(text) as T;
          },
        };
      } catch (err) {
        // 已经是 AdapterError(来自 4xx 路径)直接 rethrow,不重试
        if (err instanceof AdapterError) {
          if (err.code === 'PLATFORM_ERROR' && err.retriable && allowRetry && attempt + 1 < totalAttempts) {
            attempt++;
            await sleepBackoff(baseDelay, attempt);
            lastError = err;
            continue;
          }
          throw err;
        }
        // AbortError / 超时 / 网络错误
        const isAbort = (err as Error)?.name === 'AbortError' || ctrl.signal.aborted;
        const isTimeout = isAbort && (ctrl.signal.reason as Error)?.message === 'TIMEOUT';
        const isExternalAbort = isAbort && !isTimeout;
        if (isExternalAbort) {
          throw new AdapterError('NETWORK_ERROR', 'request aborted', false, err);
        }
        // 超时或网络层错误
        if (allowRetry && attempt + 1 < totalAttempts) {
          attempt++;
          await sleepBackoff(baseDelay, attempt);
          lastError = err;
          continue;
        }
        throw new AdapterError(
          'NETWORK_ERROR',
          isTimeout ? `request timeout after ${timeoutMs}ms` : (err as Error)?.message ?? 'network error',
          true,
          err,
        );
      } finally {
        clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener('abort', onAbort);
      }
    }
    // 不应到达此处
    throw lastError instanceof Error
      ? lastError
      : new AdapterError('NETWORK_ERROR', 'unknown error', true);
  }
}

function buildUrl(
  base: string,
  query: Record<string, string | number | boolean | undefined> | undefined,
): string {
  if (!query) return base;
  const qs: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  if (qs.length === 0) return base;
  return base + (base.includes('?') ? '&' : '?') + qs.join('&');
}

async function sleepBackoff(baseMs: number, attempt: number): Promise<void> {
  const jitter = Math.floor(Math.random() * 200);
  const delay = baseMs * 2 ** (attempt - 1) + jitter;
  await new Promise((r) => setTimeout(r, delay));
}

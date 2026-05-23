/**
 * 平台会话上下文工具：为需要绕过 Cloudflare/易盾等反爬的平台
 * 注入浏览器化请求头与平台特定 Referer，并提供按平台索引的
 * 默认超时与重试配置。
 */

import type { HttpRequest } from './client.js';
import type { PlatformId } from '../platform/adapter.js';

/** 浏览器化的默认 User-Agent（Chrome 稳定版本字符串） */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const BROWSER_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';

interface PlatformHttpProfile {
  /** 默认 Referer Origin，未来由 withSession 注入 */
  readonly referer: string;
  /** 默认 GET 超时（ms） */
  readonly defaultTimeoutMs: number;
  /** GET 默认重试次数（POST/PUT/DELETE 不重试） */
  readonly defaultRetryAttempts: number;
}

/**
 * 平台 HTTP 配置表。
 *
 * - POJ 服务器较慢，超时放宽到 30s 且 GET 默认重试 1 次
 * - 其他平台沿用全局默认（15s + 不重试）
 */
export const PLATFORM_HTTP_PROFILES: Record<PlatformId, PlatformHttpProfile> = {
  'leetcode-cn': {
    referer: 'https://leetcode.cn/',
    defaultTimeoutMs: 15_000,
    defaultRetryAttempts: 0,
  },
  hdoj: {
    referer: 'http://acm.hdu.edu.cn/',
    defaultTimeoutMs: 15_000,
    defaultRetryAttempts: 0,
  },
  codeforces: {
    referer: 'https://codeforces.com/',
    defaultTimeoutMs: 15_000,
    defaultRetryAttempts: 0,
  },
  luogu: {
    referer: 'https://www.luogu.com.cn/',
    defaultTimeoutMs: 15_000,
    defaultRetryAttempts: 0,
  },
  poj: {
    referer: 'http://poj.org/',
    defaultTimeoutMs: 30_000,
    defaultRetryAttempts: 1,
  },
  lanqiao: {
    referer: 'https://www.lanqiao.cn/',
    defaultTimeoutMs: 15_000,
    defaultRetryAttempts: 0,
  },
};

export function getPlatformHttpProfile(platform: PlatformId): PlatformHttpProfile {
  return PLATFORM_HTTP_PROFILES[platform];
}

/**
 * 把 HttpRequest 包装为带平台会话上下文的请求：
 *
 * - 自动 `injectCookieFor` + `rateLimitKey`
 * - 注入浏览器化 `User-Agent` / `Accept-Language` / `Referer`
 * - 应用平台默认超时与重试（仅当调用方未显式指定时）
 *
 * 调用方仍可通过显式字段覆盖任何默认值。
 */
export function withSession(platform: PlatformId, req: HttpRequest): HttpRequest {
  const profile = getPlatformHttpProfile(platform);
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_USER_AGENT,
    'Accept-Language': BROWSER_ACCEPT_LANGUAGE,
    Referer: profile.referer,
    ...(req.headers ?? {}),
  };
  const method = (req.method ?? 'GET').toUpperCase();
  const allowRetry = method === 'GET' || method === 'HEAD';
  const retry =
    req.retry ??
    (allowRetry && profile.defaultRetryAttempts > 0
      ? { attempts: profile.defaultRetryAttempts }
      : undefined);
  return {
    ...req,
    headers,
    injectCookieFor: req.injectCookieFor ?? platform,
    rateLimitKey: req.rateLimitKey ?? platform,
    timeoutMs: req.timeoutMs ?? profile.defaultTimeoutMs,
    retry,
  };
}

/**
 * 检测响应是否被 Cloudflare Turnstile 或网易易盾拦截。
 *
 * 仅检查 HTML 文本中的特征字符串 —— 我们不主动绕过验证，
 * 只是把这种状态归一化为 `AUTH_REQUIRED`，由前端引导用户在浏览器完成验证。
 */
export function isHumanVerificationChallenge(
  contentType: string | undefined,
  text: string,
): boolean {
  // 只对 HTML 响应做检测，避免 JSON / 其他二进制误判
  if (contentType && !contentType.toLowerCase().includes('text/html')) {
    return false;
  }
  if (!text) return false;
  const sample = text.slice(0, 4096);
  // Cloudflare Turnstile 与挑战页的常见特征
  if (/cf-turnstile|cf-challenge|challenges\.cloudflare\.com|cf_chl_opt/i.test(sample)) {
    return true;
  }
  // 网易易盾验证标记
  if (/dun\.163\.com|NECaptcha|easyDun|网易易盾/i.test(sample)) {
    return true;
  }
  return false;
}

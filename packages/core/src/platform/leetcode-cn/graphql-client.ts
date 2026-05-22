/**
 * LeetCode CN GraphQL 客户端封装。自动注入 Referer/Origin/Content-Type/Cookie;
 * 写操作自动从 cookie 中提取 csrftoken 注入 X-CSRFToken。
 */

import type { HttpClient } from '../../http/client.js';
import type { CredentialStore } from '../../auth/credential-store.js';
import { AdapterError } from '../errors.js';

const ENDPOINT = 'https://leetcode.cn/graphql/';

export interface GraphQLRequest<V> {
  query: string;
  variables?: V;
  operationName?: string;
  /** 是否为写操作 / 需要 csrftoken。 */
  requireAuth?: boolean;
}

export class LeetCodeCnGraphQLClient {
  constructor(
    private readonly http: HttpClient,
    private readonly creds: CredentialStore,
  ) {}

  async exec<T, V = Record<string, unknown>>(req: GraphQLRequest<V>): Promise<T> {
    if (req.requireAuth) {
      const cred = await this.creds.get('leetcode-cn');
      if (!cred?.cookie) {
        throw new AdapterError('AUTH_REQUIRED', '未登录 LeetCode CN', false);
      }
    }

    const headers: Record<string, string> = {
      Referer: 'https://leetcode.cn/',
      Origin: 'https://leetcode.cn',
      'Content-Type': 'application/json',
    };
    if (req.requireAuth) {
      const cred = await this.creds.get('leetcode-cn');
      const csrf = extractCookie(cred?.cookie, 'csrftoken');
      if (csrf) headers['X-CSRFToken'] = csrf;
    }

    const res = await this.http.request({
      url: ENDPOINT,
      method: 'POST',
      headers,
      body: { query: req.query, variables: req.variables, operationName: req.operationName },
      contentType: 'json',
      injectCookieFor: 'leetcode-cn',
      rateLimitKey: 'leetcode-cn',
      timeoutMs: 15_000,
    });

    let payload: { data?: T; errors?: Array<{ message: string }> };
    try {
      payload = res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', 'GraphQL 响应非 JSON', false, e);
    }
    if (payload.errors && payload.errors.length > 0) {
      const msg = payload.errors.map((e) => e.message).join('; ');
      throw new AdapterError('PLATFORM_ERROR', `GraphQL 错误: ${msg}`, false);
    }
    if (!payload.data) {
      throw new AdapterError('PARSE_ERROR', 'GraphQL 响应缺少 data', false);
    }
    return payload.data;
  }
}

export function extractCookie(cookie: string | undefined, name: string): string | undefined {
  if (!cookie) return undefined;
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${escapeRegExp(name)}=([^;]+)`));
  return m ? m[1] : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

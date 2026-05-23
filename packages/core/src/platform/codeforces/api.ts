/**
 * Codeforces HTTP 调用封装。
 *
 * - 题目列表用官方 REST API（免认证）
 * - 题面 / 提交 / 状态查询通过登录会话访问 HTML 页面
 */

import type { HttpClient } from '../../http/client.js';
import { withSession } from '../../http/session.js';
import { AdapterError } from '../errors.js';
import type { CodeforcesProblemsetResponse } from './types.js';

const API_BASE = 'https://codeforces.com/api';
const SITE_BASE = 'https://codeforces.com';

export class CodeforcesApi {
  constructor(private readonly httpClient: HttpClient) {}

  /** 拉取题集（公开 API，无需登录）。 */
  async problemset(
    options: { tags?: string[]; problemsetName?: string } = {},
  ): Promise<CodeforcesProblemsetResponse> {
    const query: Record<string, string> = {};
    if (options.tags && options.tags.length > 0) {
      query.tags = options.tags.join(';');
    }
    if (options.problemsetName) {
      query.problemsetName = options.problemsetName;
    }
    const res = await this.httpClient.request({
      url: `${API_BASE}/problemset.problems`,
      method: 'GET',
      query,
      timeoutMs: 15_000,
      rateLimitKey: 'codeforces',
    });
    let body: CodeforcesProblemsetResponse;
    try {
      body = res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', 'Codeforces problemset 响应非 JSON', false, e);
    }
    if (body.status !== 'OK' || !body.result) {
      throw new AdapterError(
        'PLATFORM_ERROR',
        `Codeforces API failed: ${body.comment ?? 'unknown'}`,
        false,
      );
    }
    return body;
  }

  /** 抓取题面 HTML，使用登录会话以减少触发 Cloudflare 概率。 */
  async fetchProblemHtml(contestId: number, index: string): Promise<string> {
    const url = `${SITE_BASE}/contest/${contestId}/problem/${index}`;
    const res = await this.httpClient.request(
      withSession('codeforces', { url, method: 'GET' }),
    );
    return res.text;
  }

  /** 抓取提交页 HTML（用于解析 CSRF token）。 */
  async fetchSubmitPageHtml(contestId: number): Promise<string> {
    const url = `${SITE_BASE}/contest/${contestId}/submit`;
    const res = await this.httpClient.request(
      withSession('codeforces', { url, method: 'GET' }),
    );
    return res.text;
  }

  /** 提交代码。提交成功后 Codeforces 会 302 到 my submissions 页面。 */
  async submit(
    contestId: number,
    body: Record<string, string>,
  ): Promise<{ status: number; locationUrl?: string; html: string }> {
    const url = `${SITE_BASE}/contest/${contestId}/submit`;
    const res = await this.httpClient.request(
      withSession('codeforces', {
        url,
        method: 'POST',
        contentType: 'form',
        body,
        headers: {
          Origin: SITE_BASE,
          Referer: url,
        },
      }),
    );
    return {
      status: res.status,
      locationUrl: res.headers['location'],
      html: res.text,
    };
  }

  /** 拉取当前用户最近提交（用于轮询）。 */
  async userStatus(handle: string, count = 10): Promise<unknown> {
    const res = await this.httpClient.request({
      url: `${API_BASE}/user.status`,
      method: 'GET',
      query: { handle, from: 1, count },
      timeoutMs: 15_000,
      rateLimitKey: 'codeforces',
    });
    try {
      return res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', 'Codeforces user.status 响应非 JSON', false, e);
    }
  }
}

/**
 * 洛谷 HTTP 调用封装。
 */

import type { HttpClient } from '../../http/client.js';
import { withSession } from '../../http/session.js';
import { AdapterError } from '../errors.js';

const BASE = 'https://www.luogu.com.cn';

export class LuoguApi {
  constructor(private readonly httpClient: HttpClient) {}

  async fetchProblemListHtml(page: number, opts: { difficulty?: number; tag?: number } = {}): Promise<string> {
    const query: Record<string, string | number> = { page };
    if (opts.difficulty !== undefined) query.difficulty = opts.difficulty;
    if (opts.tag !== undefined) query.tag = opts.tag;
    const res = await this.httpClient.request(
      withSession('luogu', {
        url: `${BASE}/problem/list`,
        method: 'GET',
        query,
      }),
    );
    return res.text;
  }

  async fetchProblemDetailHtml(pid: string): Promise<string> {
    const res = await this.httpClient.request(
      withSession('luogu', {
        url: `${BASE}/problem/${pid}`,
        method: 'GET',
      }),
    );
    return res.text;
  }

  /**
   * 提交代码到指定题目��
   * 洛谷提交端点：POST /fe/api/problem/submit/{pid}，JSON body。
   */
  async submit(
    pid: string,
    body: { lang: number; code: string; enableO2: 0 | 1 },
    csrfToken: string,
  ): Promise<{ id?: number; rid?: number }> {
    const res = await this.httpClient.request(
      withSession('luogu', {
        url: `${BASE}/fe/api/problem/submit/${pid}`,
        method: 'POST',
        contentType: 'json',
        body,
        headers: {
          'X-CSRF-Token': csrfToken,
          Origin: BASE,
          Referer: `${BASE}/problem/${pid}`,
        },
      }),
    );
    let payload: { rid?: number; id?: number; errorMessage?: string };
    try {
      payload = res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', '洛谷提交响应非 JSON', false, e);
    }
    if (payload.errorMessage) {
      throw new AdapterError('PLATFORM_ERROR', `洛谷提交失败：${payload.errorMessage}`, false);
    }
    return payload;
  }

  /**
   * 查询提交记录详情。
   * 端点：GET /record/{rid}，页面 lentille-context 中含 record 状态。
   */
  async fetchRecordHtml(rid: string): Promise<string> {
    const res = await this.httpClient.request(
      withSession('luogu', {
        url: `${BASE}/record/${rid}`,
        method: 'GET',
      }),
    );
    return res.text;
  }
}

/**
 * POJ HTTP 调用封装。统一启用 GBK 解码 + 30s 超时（来自 platform profile）。
 */

import type { HttpClient } from '../../http/client.js';
import { withSession } from '../../http/session.js';

const BASE = 'http://poj.org';

export class PojApi {
  constructor(private readonly httpClient: HttpClient) {}

  async fetchListHtml(volume: number): Promise<string> {
    const res = await this.httpClient.request(
      withSession('poj', {
        url: `${BASE}/problemlist`,
        method: 'GET',
        query: { volume: String(volume) },
        responseEncoding: 'gbk',
      }),
    );
    return res.text;
  }

  async fetchProblemHtml(pid: string): Promise<string> {
    const res = await this.httpClient.request(
      withSession('poj', {
        url: `${BASE}/problem`,
        method: 'GET',
        query: { id: pid },
        responseEncoding: 'gbk',
      }),
    );
    return res.text;
  }

  /** 表单 POST 提交。 */
  async submit(
    form: { problem_id: string; language: string; source: string; encoded?: string },
  ): Promise<{ status: number; html: string }> {
    const res = await this.httpClient.request(
      withSession('poj', {
        url: `${BASE}/submit`,
        method: 'POST',
        contentType: 'form',
        formEncoding: 'gbk',
        body: form,
        responseEncoding: 'gbk',
        headers: {
          Origin: BASE,
          Referer: `${BASE}/submit?problem_id=${form.problem_id}`,
        },
      }),
    );
    return { status: res.status, html: res.text };
  }

  async fetchStatus(query: { user_id?: string; problem_id?: string; top?: string }): Promise<string> {
    const res = await this.httpClient.request(
      withSession('poj', {
        url: `${BASE}/status`,
        method: 'GET',
        query: {
          user_id: query.user_id ?? '',
          problem_id: query.problem_id ?? '',
          ...(query.top ? { top: query.top } : {}),
        },
        responseEncoding: 'gbk',
      }),
    );
    return res.text;
  }
}

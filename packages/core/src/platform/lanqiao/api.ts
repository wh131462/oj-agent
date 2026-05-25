/**
 * 蓝桥云课 HTTP 调用封装。
 *
 * - 列表：GET /api/v2/problems/，公开接口（无需 JWT）
 * - 详情/提交：需要 JWT，401/403 时降级为 AUTH_REQUIRED
 */

import type { HttpClient } from '../../http/client.js';
import { withSession } from '../../http/session.js';
import { AdapterError } from '../errors.js';
import type { LanqiaoListResponse, LanqiaoProblemDetailRaw } from './types.js';

const BASE = 'https://www.lanqiao.cn';

function authHeaders(jwt?: string): Record<string, string> {
  return jwt ? { Authorization: `JWT ${jwt}` } : {};
}

export class LanqiaoApi {
  constructor(private readonly httpClient: HttpClient) {}

  async listProblems(
    query: { page_size: number; page: number; first_category_id?: number },
    jwt?: string,
  ): Promise<LanqiaoListResponse> {
    const res = await this.httpClient.request(
      withSession('lanqiao', {
        url: `${BASE}/api/v2/problems/pc/`,
        method: 'GET',
        query: {
          page_size: String(query.page_size),
          page: String(query.page),
          ...(query.first_category_id !== undefined
            ? { first_category_id: String(query.first_category_id) }
            : {}),
        },
        headers: authHeaders(jwt),
      }),
    );
    try {
      return res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', '蓝桥云课列表响应非 JSON', false, e);
    }
  }

  /** 题目详情。未登录时返回 401。 */
  async getProblem(id: string, jwt: string): Promise<LanqiaoProblemDetailRaw> {
    const res = await this.httpClient.request(
      withSession('lanqiao', {
        url: `${BASE}/api/v2/problems/${id}/`,
        method: 'GET',
        headers: authHeaders(jwt),
      }),
    );
    try {
      return res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', '蓝桥云课题目详情响应非 JSON', false, e);
    }
  }

  async submit(
    id: string,
    body: { language: string; code: string },
    jwt: string,
  ): Promise<{ submission_id?: string | number; id?: string | number }> {
    const res = await this.httpClient.request(
      withSession('lanqiao', {
        url: `${BASE}/api/v2/problems/${id}/submissions/`,
        method: 'POST',
        contentType: 'json',
        body,
        headers: { ...authHeaders(jwt), Origin: BASE, Referer: `${BASE}/problems/${id}/` },
      }),
    );
    try {
      return res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', '蓝桥云课提交响应非 JSON', false, e);
    }
  }

  async getSubmission(submissionId: string, jwt: string): Promise<unknown> {
    const res = await this.httpClient.request(
      withSession('lanqiao', {
        url: `${BASE}/api/v2/submissions/${submissionId}/`,
        method: 'GET',
        headers: authHeaders(jwt),
      }),
    );
    try {
      return res.json();
    } catch (e) {
      throw new AdapterError('PARSE_ERROR', '蓝桥云课提交详情响应非 JSON', false, e);
    }
  }
}

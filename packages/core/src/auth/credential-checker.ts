/**
 * 凭证失效探活。
 *
 * 仅作只读、低成本试探;任何失败一律返回 `'unknown'`,不抛错。
 */

import type { HttpClient } from '../http/client.js';
import type { PlatformId } from '../platform/adapter.js';

export type CredentialStatus = 'valid' | 'expired' | 'unknown';

const LEETCODE_USER_STATUS_QUERY = `
query globalData {
  userStatus {
    isSignedIn
    username
  }
}`;

export class CredentialChecker {
  constructor(private readonly http: HttpClient) {}

  async check(platform: PlatformId): Promise<CredentialStatus> {
    try {
      if (platform === 'leetcode-cn') return await this.checkLeetCodeCn();
      if (platform === 'hdoj') return await this.checkHdoj();
      if (platform === 'lanqiao') return await this.checkLanqiao();
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async checkLeetCodeCn(): Promise<CredentialStatus> {
    const res = await this.http.request({
      url: 'https://leetcode.cn/graphql/',
      method: 'POST',
      injectCookieFor: 'leetcode-cn',
      contentType: 'json',
      body: { query: LEETCODE_USER_STATUS_QUERY, variables: {} },
      headers: {
        Referer: 'https://leetcode.cn/',
        Origin: 'https://leetcode.cn',
      },
      timeoutMs: 8000,
    });
    try {
      const data = res.json<{ data?: { userStatus?: { isSignedIn?: boolean } } }>();
      const signed = data?.data?.userStatus?.isSignedIn;
      if (signed === true) return 'valid';
      if (signed === false) return 'expired';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async checkHdoj(): Promise<CredentialStatus> {
    const res = await this.http.request({
      url: 'http://acm.hdu.edu.cn/control_panel.php',
      method: 'GET',
      injectCookieFor: 'hdoj',
      responseEncoding: 'gbk',
      timeoutMs: 8000,
    });
    // 已登录：页面包含退出链接或欢迎词
    if (/userlogout\.php|Sign\s*[Oo]ut|退出|注销|Logout/i.test(res.text)) return 'valid';
    // 注意：fetch 默认跟随 302，未登录时会跟到登录页。
    // 但登录页也含 "登录" 中文字样，若匹配 expired 则凭证会被清除。
    // 保守策略：凡是无法确认 valid 的情况均返回 unknown，交由 login-flow 信任浏览器登录信号。
    return 'unknown';
  }

  private async checkLanqiao(): Promise<CredentialStatus> {
    // 蓝桥云课使用 JWT 认证，通常存储在 cookie 中
    // injectCookieFor 会自动注入所有 .lanqiao.cn 域下的 cookie（包括 Authorization 等）
    const res = await this.http.request({
      url: 'https://www.lanqiao.cn/api/v2/user/basic/',
      method: 'GET',
      injectCookieFor: 'lanqiao',
      timeoutMs: 8000,
    });
    if (res.status === 401 || res.status === 403) return 'expired';
    if (res.status === 200) {
      try {
        const data = res.json<{ id?: number | string; username?: string }>();
        if (data && (data.id || data.username)) return 'valid';
      } catch {}
    }
    return 'unknown';
  }
}

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
    // 已登录页含 "Sign Out" / 中文 "注销" 字样
    if (/Sign\s*Out|退出|注销/i.test(res.text)) return 'valid';
    // 未登录被跳转或返回登录表单
    if (/userloginex\.php|Sign\s*In|登录/i.test(res.text)) return 'expired';
    return 'unknown';
  }
}

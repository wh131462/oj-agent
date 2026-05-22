/**
 * 各平台的浏览器自动登录配置。
 */

import type { LoginConfig, BrowserPageHandle } from './browser-login.js';
import type { PlatformId } from '../platform/adapter.js';

const LEETCODE_CN: LoginConfig = {
  platform: 'leetcode-cn',
  loginUrl: 'https://leetcode.cn/accounts/login/',
  ready: {
    // LEETCODE_SESSION cookie 是最可靠的登录信号(账号密码 / 微信扫码 / GitHub OAuth 都会设置它)
    cookieName: 'LEETCODE_SESSION',
    // URL 兜底:匹配登录成功后的常见目标页(根路径 / 题集 / 用户页 / 会员页)
    urlPattern: /^https:\/\/leetcode\.cn\/(?:$|problemset|u\/|premium|problems)/,
  },
  cookieDomain: '.leetcode.cn',
  timeoutMs: 300_000,
  async extractUsername(page: BrowserPageHandle): Promise<string | null> {
    try {
      const url = await page.url();
      const m = url.match(/leetcode\.cn\/u\/([^/?#]+)/);
      if (m) return decodeURIComponent(m[1]!);
      return await page.evaluate<string | null>(() => {
        const a = document.querySelector('a[href^="/u/"]') as HTMLAnchorElement | null;
        if (!a) return null;
        const m2 = a.getAttribute('href')!.match(/\/u\/([^/?#]+)/);
        return m2 ? decodeURIComponent(m2[1]!) : null;
      });
    } catch {
      return null;
    }
  },
};

const HDOJ: LoginConfig = {
  platform: 'hdoj',
  loginUrl: 'http://acm.hdu.edu.cn/userloginex.php',
  ready: {
    urlPattern: /control_panel\.php/,
    cookieName: 'PHPSESSID',
  },
  cookieDomain: '.hdu.edu.cn',
  timeoutMs: 300_000,
  async extractUsername(page: BrowserPageHandle): Promise<string | null> {
    try {
      return await page.evaluate<string | null>(() => {
        const text = document.body?.innerText ?? '';
        const m = text.match(/Welcome\s+([A-Za-z0-9_-]+)/i);
        return m ? m[1]! : null;
      });
    } catch {
      return null;
    }
  },
};

export const platformLoginConfigs: Record<PlatformId, LoginConfig | undefined> = {
  'leetcode-cn': LEETCODE_CN,
  hdoj: HDOJ,
  codeforces: undefined,
  luogu: undefined,
  poj: undefined,
  lanqiao: undefined,
};

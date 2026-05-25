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
    // HDOJ 给所有访客都设置 PHPSESSID（哪怕未登录），不能作为登录信号。
    // 登录成功后页面会带 action=login 参数（POST 回调），或跳到首页 / control_panel.php。
    // 注意：登录页本身是 userloginex.php（无参数），不会误触发。
    urlPattern: /^http:\/\/acm\.hdu\.edu\.cn\/(?:$|index\.php|control_panel\.php|status\.php|userstatistics\.php|userloginex\.php\?action=login)/,
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

const CODEFORCES: LoginConfig = {
  platform: 'codeforces',
  loginUrl: 'https://codeforces.com/enter',
  ready: {
    // JSESSIONID 在未登录时也会下发；用 URL 跳转作为登录信号
    urlPattern: /^https:\/\/codeforces\.com\/(?:$|problemset|contest|profile)/,
  },
  cookieDomain: '.codeforces.com',
  timeoutMs: 300_000,
  async extractUsername(page: BrowserPageHandle): Promise<string | null> {
    try {
      return await page.evaluate<string | null>(() => {
        const el = document.querySelector('a.lang-chooser + a, a[href^="/profile/"]') as HTMLAnchorElement | null;
        if (!el) return null;
        const m = el.getAttribute('href')?.match(/\/profile\/([^/?#]+)/);
        return m ? m[1]! : null;
      });
    } catch {
      return null;
    }
  },
};

const LUOGU: LoginConfig = {
  platform: 'luogu',
  loginUrl: 'https://www.luogu.com.cn/auth/login',
  ready: {
    // __client_id 是设备级 cookie，未登录也存在；仅靠 URL 跳转判断登录
    urlPattern: /^https:\/\/www\.luogu\.com\.cn\/(?:$|problem|user|contest)/,
  },
  cookieDomain: '.luogu.com.cn',
  timeoutMs: 300_000,
  async extractUsername(page: BrowserPageHandle): Promise<string | null> {
    try {
      return await page.evaluate<string | null>(() => {
        const el = document.querySelector('a[href^="/user/"]') as HTMLAnchorElement | null;
        if (!el) return null;
        const m = el.getAttribute('href')?.match(/\/user\/(\d+)/);
        return m ? m[1]! : null;
      });
    } catch {
      return null;
    }
  },
};

const POJ: LoginConfig = {
  platform: 'poj',
  loginUrl: 'http://poj.org/login',
  ready: {
    urlPattern: /^http:\/\/poj\.org\/(?:$|userstatus|problemlist)/,
    cookieName: 'PHPSESSID',
  },
  cookieDomain: '.poj.org',
  timeoutMs: 300_000,
  async extractUsername(page: BrowserPageHandle): Promise<string | null> {
    try {
      return await page.evaluate<string | null>(() => {
        const m = document.body?.innerText?.match(/Welcome,\s*([^\s,!]+)/i);
        return m ? m[1]! : null;
      });
    } catch {
      return null;
    }
  },
};

const LANQIAO: LoginConfig = {
  platform: 'lanqiao',
  // 蓝桥云课 SSO 通过 passport.lanqiao.cn 完成,成功后跳回主站或停留在 profile 页
  loginUrl: 'https://passport.lanqiao.cn/login',
  ready: {
    // 登录成功后可能跳转到 www.lanqiao.cn 或停留在 passport.lanqiao.cn/profile
    urlPattern: /^https:\/\/(www|passport)\.lanqiao\.cn\/(profile)?/,
  },
  cookieDomain: '.lanqiao.cn',
  timeoutMs: 300_000,
  async extractUsername(page: BrowserPageHandle): Promise<string | null> {
    try {
      // 尝试从页面提取用户信息
      return await page.evaluate<string | null>(() => {
        // 尝试从用户菜单或链接提取
        const userLink = document.querySelector('a[href*="/user/"]') as HTMLAnchorElement | null;
        if (userLink) {
          const m = userLink.getAttribute('href')?.match(/\/user\/(\d+)/);
          if (m) return m[1]!;
        }
        // 尝试从 localStorage 提取
        try {
          const userInfo = localStorage.getItem('userInfo');
          if (userInfo) {
            const parsed = JSON.parse(userInfo);
            return parsed.id || parsed.username || null;
          }
        } catch {}
        return null;
      });
    } catch {
      return null;
    }
  },
};

export const platformLoginConfigs: Record<PlatformId, LoginConfig | undefined> = {
  'leetcode-cn': LEETCODE_CN,
  hdoj: HDOJ,
  codeforces: CODEFORCES,
  luogu: LUOGU,
  poj: POJ,
  lanqiao: LANQIAO,
};

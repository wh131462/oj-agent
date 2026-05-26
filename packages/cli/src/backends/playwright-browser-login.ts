/**
 * PlaywrightBrowserLogin:基于 playwright-core 的 BrowserLoginCapture 实现。
 *
 * 不下载 Chromium 二进制,自动检测系统 Chrome / Edge / Brave / Chromium。
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import {
  BrowserLoginCancelledError,
  BrowserLoginTimeoutError,
  BrowserNotFoundError,
  type BrowserLoginCapture,
  type BrowserPageHandle,
  type CapturedAuth,
  type LoginConfig,
} from '@oj-agent/core';

type PlaywrightModule = typeof import('playwright-core');
type BrowserContext = import('playwright-core').BrowserContext;
type Page = import('playwright-core').Page;

interface BrowserCandidate {
  name: 'chrome' | 'msedge' | 'brave' | 'chromium';
  channel?: 'chrome' | 'msedge' | 'chromium';
  executablePath?: string;
}

export interface PlaywrightOptions {
  /** 优先尝试的浏览器(`oja login --browser=...`)。 */
  preferredBrowser?: 'chrome' | 'msedge' | 'brave' | 'chromium';
  /** 启动浏览器后,在用户操作之前调用,用于打印进度提示。 */
  onLaunched?: (info: { name: string; path: string }) => void;
}

export class PlaywrightBrowserLogin implements BrowserLoginCapture {
  private context?: BrowserContext;
  private cancelled = false;

  constructor(private opts: PlaywrightOptions = {}) {}

  async capture(config: LoginConfig): Promise<CapturedAuth> {
    this.cancelled = false;
    this.validateReady(config);

    const playwright = await loadPlaywright();
    if (!playwright) throw new BrowserNotFoundError('playwright-core 不可用,请安装 playwright-core');

    const candidates = orderCandidates(this.opts.preferredBrowser);
    const launchResult = await this.tryLaunch(playwright, candidates, config.platform);
    if (!launchResult) {
      throw new BrowserNotFoundError();
    }
    const { context, info } = launchResult;
    this.context = context;
    this.opts.onLaunched?.(info);

    try {
      const page = await context.newPage();
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {
        // 继续等待 — 有些站点 domcontentloaded 不触发,但页面可用
      });

      const captured = await this.waitForLogin(page, config);

      // 关键:OAuth / 微信扫码场景下,ready 信号触发后还有后续 redirect(callback → 设 cookie → 跳首页)
      // 等待 2s 让所有 cookie 完全写入,避免拿到半完整状态。
      await page.waitForTimeout(2000).catch(() => {});

      // 若信号触发后还未读到用户名,尝试导航到平台规定的"自我"页(LeetCode 用 /u/me/)再读
      let username: string | null = captured.username ?? null;
      if (!username && config.extractUsername) {
        try {
          username = await config.extractUsername(wrapPage(page));
        } catch {
          username = null;
        }
      }
      if (!username && config.platform === 'leetcode-cn') {
        // LeetCode 兜底:导航到 /u/me/ 再抽
        try {
          await page.goto('https://leetcode.cn/u/me/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
          await page.waitForTimeout(500);
          username = config.extractUsername ? await config.extractUsername(wrapPage(page)) : null;
        } catch {
          // 忽略,用户名可后续手动补
        }
      }
      // 蓝桥云课：登录成功后停留在 passport.lanqiao.cn/profile，需要主动访问 www.lanqiao.cn
      // 以触发主站 cookie（lqtoken 等）的写入
      if (config.platform === 'lanqiao') {
        try {
          await page.goto('https://www.lanqiao.cn/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
          await page.waitForTimeout(1000);
        } catch {
          // ignore
        }
      }

      const cookies = await context.cookies();
      const filtered = filterCookies(cookies, config.cookieDomain);
      const cookieHeader = filtered.map((c) => `${c.name}=${c.value}`).join('; ');

      return {
        cookie: cookieHeader,
        username: username ?? undefined,
        browserInfo: info,
      };
    } finally {
      await this.cleanup();
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // 忽略
      }
      this.context = undefined;
    }
    // 持久化 profile：不再删除 userDataDir，保留登录态供下次复用
  }

  private validateReady(config: LoginConfig): void {
    const r = config.ready;
    if (!r || (!r.urlPattern && !r.cookieName && !r.selector)) {
      throw new Error('LoginConfig.ready 必须至少声明一个信号(urlPattern / cookieName / selector)');
    }
  }

  private async tryLaunch(
    playwright: PlaywrightModule,
    candidates: BrowserCandidate[],
    platform: string,
  ): Promise<{ context: BrowserContext; info: { name: string; path: string } } | undefined> {
    for (const c of candidates) {
      if (c.executablePath && !existsSync(c.executablePath)) continue;
      const userDataDir = path.join(os.homedir(), '.oja', 'browser-profile', platform);
      await fs.mkdir(userDataDir, { recursive: true });
      const launchOptions: Parameters<typeof playwright.chromium.launchPersistentContext>[1] = {
        headless: false,
        args: ['--no-first-run', '--no-default-browser-check'],
        viewport: { width: 1024, height: 768 },
      };
      if (c.channel) launchOptions.channel = c.channel;
      if (c.executablePath) launchOptions.executablePath = c.executablePath;
      try {
        const context = await playwright.chromium.launchPersistentContext(userDataDir, launchOptions);
        return {
          context,
          info: { name: c.name, path: c.executablePath ?? c.channel ?? 'unknown' },
        };
      } catch {
        // 首次失败：可能是 profile 损坏（异常退出残留 lock 文件、版本不兼容等），
        // 清空该 platform profile 后重试一次。
        try {
          await fs.rm(userDataDir, { recursive: true, force: true });
          await fs.mkdir(userDataDir, { recursive: true });
          const context = await playwright.chromium.launchPersistentContext(userDataDir, launchOptions);
          return {
            context,
            info: { name: c.name, path: c.executablePath ?? c.channel ?? 'unknown' },
          };
        } catch {
          // 仍失败,尝试下一候选浏览器
          continue;
        }
      }
    }
    return undefined;
  }

  private async waitForLogin(
    page: Page,
    config: LoginConfig,
  ): Promise<{ username?: string }> {
    const timeoutMs = config.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    const intervalMs = 500;

    while (Date.now() < deadline) {
      if (this.cancelled) throw new BrowserLoginCancelledError();

      const currentUrl = (() => {
        try {
          return page.url();
        } catch {
          return '';
        }
      })();
      // 不算登录成功的"门槛":必须已经离开登录页 / OAuth 回调中转页
      const stillOnLogin =
        currentUrl.includes('/accounts/login') ||
        currentUrl.includes('/oauth') ||
        currentUrl.includes('github.com') ||
        currentUrl.includes('open.weixin.qq.com');

      // urlPattern
      if (config.ready.urlPattern && !stillOnLogin) {
        if (config.ready.urlPattern.test(currentUrl)) return {};
      }
      // cookieName:必须 value 非空 + 不在登录/OAuth 中转页
      if (config.ready.cookieName && this.context && !stillOnLogin) {
        const cookies = await this.context.cookies().catch(() => [] as Array<{ name: string; value: string }>);
        const hit = cookies.find((c) => c.name === config.ready.cookieName);
        if (hit && hit.value && hit.value.length > 5) return {};
      }
      // selector
      if (config.ready.selector && !stillOnLogin) {
        try {
          const el = await page.$(config.ready.selector);
          if (el) return {};
        } catch {
          // 忽略
        }
      }

      await page.waitForTimeout(intervalMs).catch(() => {
        // 页面可能已 close
      });
    }

    throw new BrowserLoginTimeoutError(timeoutMs);
  }
}

/** lazy 加载 playwright-core,失败返回 null。 */
async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    const m = await import('playwright-core');
    return m;
  } catch {
    return null;
  }
}

function orderCandidates(preferred?: string): BrowserCandidate[] {
  const all: BrowserCandidate[] = [
    { name: 'chrome', channel: 'chrome' },
    { name: 'msedge', channel: 'msedge' },
    { name: 'brave', executablePath: detectBravePath() ?? '' },
    { name: 'chromium', channel: 'chromium' },
  ];
  // 过滤 brave 在 executablePath === '' 时跳过
  const filtered = all.filter((c) => c.executablePath !== '');
  if (preferred) {
    const head = filtered.filter((c) => c.name === preferred);
    const rest = filtered.filter((c) => c.name !== preferred);
    return [...head, ...rest];
  }
  return filtered;
}

function detectBravePath(): string | null {
  if (process.platform === 'darwin') {
    return '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  }
  if (process.platform === 'linux') {
    const candidates = ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave'];
    for (const p of candidates) if (existsSync(p)) return p;
    return null;
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const program = process.env.PROGRAMFILES;
    const candidates = [
      local && path.join(local, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
      program && path.join(program, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
    ].filter(Boolean) as string[];
    for (const p of candidates) if (existsSync(p)) return p;
    return null;
  }
  return null;
}

function filterCookies(
  cookies: Array<{ name: string; value: string; domain: string }>,
  domainFilter?: string,
): Array<{ name: string; value: string; domain: string }> {
  if (!domainFilter) return cookies;
  // .leetcode.cn 应匹配 leetcode.cn 与所有子域
  const target = domainFilter.startsWith('.') ? domainFilter.slice(1) : domainFilter;
  return cookies.filter((c) => {
    const d = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    return d === target || d.endsWith('.' + target) || target.endsWith('.' + d);
  });
}

function wrapPage(page: Page): BrowserPageHandle {
  return {
    async url() {
      return page.url();
    },
    async cookies() {
      const ctx = page.context();
      return ctx.cookies();
    },
    async evaluate<T>(fn: () => T): Promise<T> {
      // playwright 的 page.evaluate 接受函数序列化执行
      return page.evaluate(fn) as Promise<T>;
    },
  };
}

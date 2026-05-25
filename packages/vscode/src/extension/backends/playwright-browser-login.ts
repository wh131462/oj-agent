/**
 * VSCode 端 PlaywrightBrowserLogin。逻辑与 CLI 端一致,
 * 但浏览器 onLaunched 回调通过 VSCode 进度通知或日志通道反馈进度。
 *
 * 这是 CLI 实现的复制(monorepo 共享 helper 留到 M2 优化)。
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
  preferredBrowser?: 'chrome' | 'msedge' | 'brave' | 'chromium';
  onLaunched?: (info: { name: string; path: string }) => void;
}

export class PlaywrightBrowserLogin implements BrowserLoginCapture {
  private context?: BrowserContext;
  private cancelled = false;
  private userDataDir?: string;

  constructor(private opts: PlaywrightOptions = {}) {}

  async capture(config: LoginConfig): Promise<CapturedAuth> {
    this.cancelled = false;
    this.validateReady(config);

    const playwright = await loadPlaywright();
    if (!playwright) throw new BrowserNotFoundError('playwright-core 不可用,请安装 playwright-core');

    const candidates = orderCandidates(this.opts.preferredBrowser);
    const launchResult = await this.tryLaunch(playwright, candidates);
    if (!launchResult) throw new BrowserNotFoundError();
    const { context, info } = launchResult;
    this.context = context;
    this.opts.onLaunched?.(info);

    try {
      const page = await context.newPage();
      await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const captured = await this.waitForLogin(page, config);

      // OAuth / 微信扫码场景下,ready 信号触发后还有后续 redirect。等 2s 让所有 cookie 写入。
      await page.waitForTimeout(2000).catch(() => {});

      let username: string | null = captured.username ?? null;
      if (!username && config.extractUsername) {
        try {
          username = await config.extractUsername(wrapPage(page));
        } catch {
          username = null;
        }
      }
      if (!username && config.platform === 'leetcode-cn') {
        try {
          await page.goto('https://leetcode.cn/u/me/', {
            waitUntil: 'domcontentloaded',
            timeout: 10_000,
          });
          await page.waitForTimeout(500);
          username = config.extractUsername ? await config.extractUsername(wrapPage(page)) : null;
        } catch {
          // ignore
        }
      }
      // 蓝桥云课：登录成功后停留在 passport.lanqiao.cn/profile，需要主动访问 www.lanqiao.cn
      // 以触发主站 cookie（lqtoken 等）的写入
      if (config.platform === 'lanqiao') {
        try {
          await page.goto('https://www.lanqiao.cn/', {
            waitUntil: 'domcontentloaded',
            timeout: 10_000,
          });
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
        // ignore
      }
      this.context = undefined;
    }
    if (this.userDataDir) {
      const dir = this.userDataDir;
      this.userDataDir = undefined;
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
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
  ): Promise<{ context: BrowserContext; info: { name: string; path: string } } | undefined> {
    for (const c of candidates) {
      if (c.executablePath && !existsSync(c.executablePath)) continue;
      try {
        const userDataDir = path.join(
          os.tmpdir(),
          `oja-login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        await fs.mkdir(userDataDir, { recursive: true });
        const launchOptions: Parameters<typeof playwright.chromium.launchPersistentContext>[1] = {
          headless: false,
          args: ['--no-first-run', '--no-default-browser-check'],
          viewport: { width: 1024, height: 768 },
        };
        if (c.channel) launchOptions.channel = c.channel;
        if (c.executablePath) launchOptions.executablePath = c.executablePath;
        const context = await playwright.chromium.launchPersistentContext(userDataDir, launchOptions);
        this.userDataDir = userDataDir;
        return {
          context,
          info: { name: c.name, path: c.executablePath ?? c.channel ?? 'unknown' },
        };
      } catch {
        if (this.userDataDir) {
          await fs.rm(this.userDataDir, { recursive: true, force: true }).catch(() => {});
          this.userDataDir = undefined;
        }
        continue;
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
      const stillOnLogin =
        currentUrl.includes('/accounts/login') ||
        currentUrl.includes('/oauth') ||
        currentUrl.includes('github.com') ||
        currentUrl.includes('open.weixin.qq.com');

      if (config.ready.urlPattern && !stillOnLogin) {
        if (config.ready.urlPattern.test(currentUrl)) return {};
      }
      if (config.ready.cookieName && this.context && !stillOnLogin) {
        const cookies = await this.context.cookies().catch(() => [] as Array<{ name: string; value: string }>);
        const hit = cookies.find((c) => c.name === config.ready.cookieName);
        if (hit && hit.value && hit.value.length > 5) return {};
      }
      if (config.ready.selector && !stillOnLogin) {
        try {
          const el = await page.$(config.ready.selector);
          if (el) return {};
        } catch {
          // ignore
        }
      }

      await page.waitForTimeout(intervalMs).catch(() => {});
    }
    throw new BrowserLoginTimeoutError(timeoutMs);
  }
}

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
      return page.evaluate(fn) as Promise<T>;
    },
  };
}

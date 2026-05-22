/**
 * 浏览器自动登录的接口契约。core 不依赖 playwright/vscode,
 * 由前端注入具体实现(`packages/cli` 与 `packages/vscode` 各自的 PlaywrightBrowserLogin)。
 */

import type { PlatformId } from '../platform/adapter.js';

/**
 * 浏览器页面句柄,屏蔽具体浏览器引擎差异。
 */
export interface BrowserPageHandle {
  url(): Promise<string>;
  cookies(): Promise<Array<{ name: string; value: string; domain: string }>>;
  evaluate<T>(fn: () => T): Promise<T>;
}

export interface LoginConfig {
  platform: PlatformId;
  loginUrl: string;
  ready: {
    urlPattern?: RegExp;
    cookieName?: string;
    selector?: string;
  };
  extractUsername?: (page: BrowserPageHandle) => Promise<string | null>;
  cookieDomain?: string;
  timeoutMs?: number;
}

export interface CapturedAuth {
  cookie: string;
  username?: string;
  browserInfo?: { name: string; path: string; version?: string };
}

export class BrowserNotFoundError extends Error {
  constructor(message = '系统未检测到任何 Chromium 系浏览器(Chrome/Edge/Brave/Chromium)') {
    super(message);
    this.name = 'BrowserNotFoundError';
  }
}

export class BrowserLoginCancelledError extends Error {
  constructor(message = '浏览器登录已取消') {
    super(message);
    this.name = 'BrowserLoginCancelledError';
  }
}

export class BrowserLoginTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`浏览器登录超过 ${timeoutMs}ms 仍未完成`);
    this.name = 'BrowserLoginTimeoutError';
  }
}

export interface BrowserLoginCapture {
  capture(config: LoginConfig): Promise<CapturedAuth>;
  cancel?(): Promise<void>;
}

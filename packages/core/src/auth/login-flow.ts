/**
 * 浏览器自动登录的编排器。
 *
 * `LoginFlow.run` 严格不抛异常,所有路径走 LoginResult.ok 返回。
 */

import {
  BrowserLoginCancelledError,
  BrowserLoginTimeoutError,
  BrowserNotFoundError,
  type BrowserLoginCapture,
  type LoginConfig,
} from './browser-login.js';
import type { CredentialStore } from './credential-store.js';
import type { CredentialChecker } from './credential-checker.js';
import { NoopLogger, type LoggerBackend } from '../logger/logger.js';

export type LoginFailureReason =
  | 'browser-not-found'
  | 'capture-failed'
  | 'auth-invalid'
  | 'timeout'
  | 'cancelled';

export type LoginResult =
  | {
      ok: true;
      username?: string;
      browserInfo?: { name: string; path: string; version?: string };
    }
  | {
      ok: false;
      reason: LoginFailureReason;
      message: string;
    };

export interface LoginFlowDeps {
  capture: BrowserLoginCapture;
  credentialStore: CredentialStore;
  credChecker: CredentialChecker;
  logger?: LoggerBackend;
}

export class LoginFlow {
  private readonly logger: LoggerBackend;

  constructor(private readonly deps: LoginFlowDeps) {
    this.logger = deps.logger ?? new NoopLogger();
  }

  async run(config: LoginConfig): Promise<LoginResult> {
    let captured;
    try {
      captured = await this.deps.capture.capture(config);
    } catch (e) {
      return mapCaptureError(e);
    }

    try {
      await this.deps.credentialStore.set(config.platform, {
        platform: config.platform,
        cookie: captured.cookie,
        extra: captured.username ? { username: captured.username } : undefined,
      });
    } catch (e) {
      this.logger.warn('auth', 'credentialStore.set failed', { error: (e as Error).message });
      return {
        ok: false,
        reason: 'capture-failed',
        message: '凭证写入失败: ' + (e as Error).message,
      };
    }

    let status;
    try {
      status = await this.deps.credChecker.check(config.platform);
    } catch (e) {
      this.logger.warn('auth', 'credChecker.check threw', { error: (e as Error).message });
      status = 'unknown' as const;
    }

    // valid: 校验通过；unknown: 平台暂无校验逻辑或网络问题，信任浏览器登录信号
    if (status === 'valid' || status === 'unknown') {
      this.logger.info('auth', 'browser-auto-login succeeded', {
        platform: config.platform,
        username: captured.username,
        credStatus: status,
      });
      return {
        ok: true,
        username: captured.username,
        browserInfo: captured.browserInfo,
      };
    }

    try {
      await this.deps.credentialStore.delete(config.platform);
    } catch {
      // ignore
    }
    return {
      ok: false,
      reason: 'auth-invalid',
      message: 'cookie 校验未通过(已过期或无效)',
    };
  }

  async cancel(): Promise<void> {
    if (this.deps.capture.cancel) {
      await this.deps.capture.cancel();
    }
  }
}

function mapCaptureError(e: unknown): LoginResult {
  if (e instanceof BrowserNotFoundError) {
    return { ok: false, reason: 'browser-not-found', message: e.message };
  }
  if (e instanceof BrowserLoginCancelledError) {
    return { ok: false, reason: 'cancelled', message: e.message };
  }
  if (e instanceof BrowserLoginTimeoutError) {
    return { ok: false, reason: 'timeout', message: e.message };
  }
  if (e instanceof Error) {
    return { ok: false, reason: 'capture-failed', message: e.message };
  }
  return { ok: false, reason: 'capture-failed', message: String(e) };
}

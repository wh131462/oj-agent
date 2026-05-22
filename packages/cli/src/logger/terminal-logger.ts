/**
 * Terminal logger:LoggerBackend 路由到 stderr。
 */

import type { LoggerBackend } from '@oj-agent/core';
import type { GlobalOptions } from '../utils/globals.js';

export class TerminalLogger implements LoggerBackend {
  constructor(private readonly opts: GlobalOptions) {}

  info(scope: string, message: string, extra?: Record<string, unknown>): void {
    if (this.opts.quiet || this.opts.json) return;
    if (this.opts.verbose) {
      this.write('[info]', scope, message, extra);
    }
    // 默认 info 不输出,避免噪音
  }

  warn(scope: string, message: string, extra?: Record<string, unknown>): void {
    if (this.opts.json) return;
    this.write('[warn]', scope, message, extra);
  }

  error(scope: string, message: string, err?: unknown): void {
    if (this.opts.json) {
      // JSON 模式:错误也走 stderr,但不带颜色
      process.stderr.write(`[error] [${scope}] ${message}` + this.formatErr(err) + '\n');
      return;
    }
    this.write('[error]', scope, message, err ? { error: this.formatErr(err) } : undefined);
  }

  private write(level: string, scope: string, message: string, extra?: unknown): void {
    let line = `${level} [${scope}] ${message}`;
    if (extra !== undefined) line += ' ' + JSON.stringify(extra);
    process.stderr.write(line + '\n');
  }

  private formatErr(err: unknown): string {
    if (err instanceof Error) {
      return this.opts.verbose ? `\n${err.stack ?? err.message}` : ` (${err.message})`;
    }
    if (err === undefined) return '';
    return ` (${String(err)})`;
  }
}

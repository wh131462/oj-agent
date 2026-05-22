/**
 * 状态栏 / 进度行渲染。TTY 下用 \r,非 TTY 直接换行。
 */

import { colorize } from './ansi.js';
import type { GlobalOptions } from '../utils/globals.js';

export class ProgressLine {
  private lastLength = 0;
  private active = false;

  constructor(private readonly opts: GlobalOptions) {}

  private get ansi(): boolean {
    return !this.opts.noColor && !this.opts.json && Boolean(process.stderr.isTTY);
  }

  update(text: string): void {
    if (this.opts.json || this.opts.quiet) return;
    if (this.ansi) {
      process.stderr.write('\r' + text.padEnd(this.lastLength, ' '));
      this.lastLength = stripAnsiLen(text);
      this.active = true;
    } else {
      process.stderr.write(text + '\n');
    }
  }

  done(final: string): void {
    if (this.opts.json) return;
    if (this.ansi && this.active) {
      process.stderr.write('\r' + final.padEnd(this.lastLength, ' ') + '\n');
    } else if (!this.opts.quiet) {
      process.stderr.write(final + '\n');
    }
    this.active = false;
    this.lastLength = 0;
  }

  fail(final: string): void {
    if (this.opts.json) return;
    if (this.ansi && this.active) {
      process.stderr.write('\r' + colorize(true, 'red', final).padEnd(this.lastLength + 10, ' ') + '\n');
    } else {
      process.stderr.write(final + '\n');
    }
    this.active = false;
    this.lastLength = 0;
  }
}

function stripAnsiLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

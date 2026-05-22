import * as vscode from 'vscode';
import type { LoggerBackend } from '@oj-agent/core';

export class VSCodeOutputChannelLogger implements LoggerBackend {
  private readonly channel: vscode.LogOutputChannel;

  constructor(name: string = 'OJ-Agent') {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  info(scope: string, msg: string, extra?: Record<string, unknown>): void {
    this.channel.info(`[${scope}] ${msg}${extra ? ' ' + this.safeStringify(extra) : ''}`);
  }

  warn(scope: string, msg: string, extra?: Record<string, unknown>): void {
    this.channel.warn(`[${scope}] ${msg}${extra ? ' ' + this.safeStringify(extra) : ''}`);
  }

  error(scope: string, msg: string, err?: unknown): void {
    const tail = err === undefined ? '' : ' ' + this.safeStringify(this.normalizeErr(err));
    this.channel.error(`[${scope}] ${msg}${tail}`);
  }

  show(preserveFocus = true): void {
    this.channel.show(preserveFocus);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private normalizeErr(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return { name: err.name, message: err.message, stack: err.stack };
    }
    if (err && typeof err === 'object') return err as Record<string, unknown>;
    return { value: String(err) };
  }

  private safeStringify(obj: Record<string, unknown>): string {
    try {
      return JSON.stringify(obj);
    } catch {
      return '[unserializable]';
    }
  }
}

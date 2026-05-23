/**
 * Debug 日志缓冲（仅 dev 模式可观测）
 * 实现 LoggerBackend，将所有日志写入环形缓冲，并广播给已订阅的观察者（如 DebugWebviewPanel）。
 */

import type { LoggerBackend } from '@oj-agent/core';

export interface DebugLogEntry {
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  extra?: string;
  timestamp: string;
}

type Listener = (entry: DebugLogEntry) => void;

export class DebugLogStore implements LoggerBackend {
  private readonly entries: DebugLogEntry[] = [];
  private readonly maxEntries = 500;
  private readonly listeners = new Set<Listener>();

  info(scope: string, message: string, extra?: Record<string, unknown>): void {
    this.append('info', scope, message, extra);
  }

  warn(scope: string, message: string, extra?: Record<string, unknown>): void {
    this.append('warn', scope, message, extra);
  }

  error(scope: string, message: string, err?: unknown): void {
    let extra: Record<string, unknown> | undefined;
    if (err instanceof Error) {
      extra = { name: err.name, message: err.message };
      if (err.stack) extra.stack = err.stack;
    } else if (err !== undefined) {
      extra = { value: String(err) };
    }
    this.append('error', scope, message, extra);
  }

  getHistory(): readonly DebugLogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries.length = 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private append(
    level: DebugLogEntry['level'],
    scope: string,
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    const entry: DebugLogEntry = {
      level,
      scope,
      message,
      extra: extra ? JSON.stringify(extra) : undefined,
      timestamp: new Date().toISOString().slice(11, 23),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {
        /* ignore */
      }
    }
  }
}

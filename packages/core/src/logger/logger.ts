/**
 * 日志后端契约。core 代码使用 logger 而非直接 console.*,
 * 前端注入具体实现(VSCode OutputChannel / CLI stderr)。
 */

export interface LoggerBackend {
  info(scope: string, message: string, extra?: Record<string, unknown>): void;
  warn(scope: string, message: string, extra?: Record<string, unknown>): void;
  error(scope: string, message: string, err?: unknown): void;
}

export class NoopLogger implements LoggerBackend {
  info(_scope: string, _message: string, _extra?: Record<string, unknown>): void {}
  warn(_scope: string, _message: string, _extra?: Record<string, unknown>): void {}
  error(_scope: string, _message: string, _err?: unknown): void {}
}

/**
 * 已知 scope 命名。logger 调用建议使用此集合内的字符串字面量,
 * 便于前端做过滤、着色、归档。
 */
export type LoggerScope =
  | 'http'
  | 'auth'
  | 'platform.leetcode-cn'
  | 'platform.hdoj'
  | 'workspace'
  | 'judge'
  | 'submission';

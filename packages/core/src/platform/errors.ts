/**
 * 适配器错误归一化。
 *
 * 所有 `PlatformAdapter` 实现的拒绝路径必须抛出 `AdapterError`,
 * 上层 UI / CLI 只看 `code`,不关心底层细节。
 */

export type AdapterErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'PARSE_ERROR'
  | 'PLATFORM_ERROR'
  | 'LANG_UNSUPPORTED'
  | 'NOT_FOUND'
  | 'JUDGING_TIMEOUT';

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    public readonly retriable: boolean = false,
    public readonly source?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

/** HTTP 状态码到 AdapterErrorCode 的标准映射。 */
export function fromHttpStatus(status: number): {
  code: AdapterErrorCode;
  retriable: boolean;
} {
  if (status === 401 || status === 403) return { code: 'AUTH_REQUIRED', retriable: false };
  if (status === 404) return { code: 'NOT_FOUND', retriable: false };
  if (status === 429) return { code: 'RATE_LIMITED', retriable: true };
  if (status >= 500 && status < 600) return { code: 'PLATFORM_ERROR', retriable: true };
  return { code: 'PLATFORM_ERROR', retriable: false };
}

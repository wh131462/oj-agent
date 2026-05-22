/**
 * 在线提交编排:登录校验 -> 最小间隔 -> submit -> pollResult,带 onProgress 回调。
 */

import { AdapterError } from '../platform/errors.js';
import { NoopLogger, type LoggerBackend } from '../logger/logger.js';
import type {
  PlatformId,
  PlatformJudgeResult,
} from '../platform/adapter.js';
import type { PlatformAdapterRegistry } from '../platform/registry.js';
import type { CredentialStore } from '../auth/credential-store.js';

export type SubmissionProgress =
  | { stage: 'pre-check' }
  | { stage: 'submitting' }
  | { stage: 'judging'; partial?: PlatformJudgeResult }
  | { stage: 'done'; result: PlatformJudgeResult };

export interface SubmissionRunInput {
  platform: PlatformId;
  problemId: string;
  lang: string;
  code: string;
  minIntervalMs?: number;
  pollTimeoutMs?: number;
  onProgress?: (state: SubmissionProgress) => void;
  signal?: AbortSignal;
}

export interface SubmissionRunnerDeps {
  registry: PlatformAdapterRegistry;
  credentialStore: CredentialStore;
  logger?: LoggerBackend;
}

export class SubmissionRunner {
  private readonly logger: LoggerBackend;
  /** 各平台上次提交时间戳(进程内,重启即清)。 */
  private readonly lastSubmitAt = new Map<PlatformId, number>();

  constructor(private readonly deps: SubmissionRunnerDeps) {
    this.logger = deps.logger ?? new NoopLogger();
  }

  async run(input: SubmissionRunInput): Promise<PlatformJudgeResult> {
    const emit = (s: SubmissionProgress) => {
      try {
        input.onProgress?.(s);
      } catch (e) {
        this.logger.warn('submission', 'onProgress listener threw', { error: (e as Error).message });
      }
    };

    emit({ stage: 'pre-check' });

    if (input.signal?.aborted) {
      throw new AdapterError('NETWORK_ERROR', 'request aborted', false);
    }

    // 登录校验
    const cred = await this.deps.credentialStore.get(input.platform);
    if (!cred?.cookie) {
      throw new AdapterError('AUTH_REQUIRED', `请先登录 ${input.platform}`, false);
    }

    // 最小间隔校验
    const minIntervalMs = input.minIntervalMs ?? 5000;
    const last = this.lastSubmitAt.get(input.platform) ?? 0;
    const elapsed = Date.now() - last;
    if (last > 0 && elapsed < minIntervalMs) {
      const remain = Math.ceil((minIntervalMs - elapsed) / 1000);
      throw new AdapterError(
        'RATE_LIMITED',
        `请稍后重试 (剩余 ${remain}s)`,
        true,
      );
    }

    if (input.signal?.aborted) {
      throw new AdapterError('NETWORK_ERROR', 'request aborted', false);
    }

    const adapter = this.deps.registry.get(input.platform);

    // 提交
    emit({ stage: 'submitting' });
    let sid: string;
    try {
      sid = await adapter.submit(input.problemId, input.lang, input.code);
    } catch (e) {
      throw wrapError(e);
    }
    this.lastSubmitAt.set(input.platform, Date.now());

    if (input.signal?.aborted) {
      throw new AdapterError('NETWORK_ERROR', 'request aborted', false);
    }

    // 轮询
    emit({ stage: 'judging' });
    let result: PlatformJudgeResult;
    try {
      result = await adapter.pollResult(sid);
    } catch (e) {
      throw wrapError(e);
    }

    emit({ stage: 'done', result });
    return result;
  }
}

function wrapError(e: unknown): Error {
  if (e instanceof AdapterError) return e;
  if (e instanceof Error) {
    return new AdapterError('PLATFORM_ERROR', e.message, false, e);
  }
  return new AdapterError('PLATFORM_ERROR', String(e), false, e);
}

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { SubmissionRunner, type SubmissionProgress } from '../src/submission/runner.js';
import { AdapterError } from '../src/platform/errors.js';
import type { PlatformAdapter, PlatformJudgeResult } from '../src/platform/adapter.js';
import type { PlatformAdapterRegistry } from '../src/platform/registry.js';
import { SecretCredentialStore } from '../src/auth/credential-store.js';
import { MemorySecretBackend } from './_helpers/memory-secret-backend.js';

function makeRegistry(adapter: Partial<PlatformAdapter>): PlatformAdapterRegistry {
  return {
    get: (_id) => adapter as PlatformAdapter,
  } as unknown as PlatformAdapterRegistry;
}

function judgeResult(over: Partial<PlatformJudgeResult> = {}): PlatformJudgeResult {
  return {
    submissionId: '1',
    verdict: 'AC',
    timeMs: 100,
    memoryKb: 1024,
    ...over,
  };
}

test('SubmissionRunner: 未登录抛 AUTH_REQUIRED,不调 submit', async () => {
  let submitCalled = false;
  const adapter = {
    submit: async () => {
      submitCalled = true;
      return '1';
    },
  };
  const runner = new SubmissionRunner({
    registry: makeRegistry(adapter),
    credentialStore: new SecretCredentialStore(new MemorySecretBackend()),
  });
  const events: SubmissionProgress[] = [];
  await assert.rejects(
    () =>
      runner.run({
        platform: 'leetcode-cn',
        problemId: '1',
        lang: 'cpp',
        code: '...',
        onProgress: (s) => events.push(s),
      }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'AUTH_REQUIRED',
  );
  assert.equal(submitCalled, false);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.stage, 'pre-check');
});

test('SubmissionRunner: 完整 happy path', async () => {
  const adapter = {
    submit: async () => '999',
    pollResult: async () => judgeResult({ submissionId: '999', verdict: 'AC' }),
  };
  const creds = new SecretCredentialStore(new MemorySecretBackend());
  await creds.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'csrftoken=x' });
  const runner = new SubmissionRunner({ registry: makeRegistry(adapter), credentialStore: creds });

  const events: SubmissionProgress[] = [];
  const r = await runner.run({
    platform: 'leetcode-cn',
    problemId: '1',
    lang: 'cpp',
    code: '...',
    onProgress: (s) => events.push(s),
  });
  assert.equal(r.verdict, 'AC');
  assert.deepEqual(events.map((e) => e.stage), ['pre-check', 'submitting', 'judging', 'done']);
});

test('SubmissionRunner: 最小间隔拒绝', async () => {
  const adapter = {
    submit: async () => '1',
    pollResult: async () => judgeResult(),
  };
  const creds = new SecretCredentialStore(new MemorySecretBackend());
  await creds.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'csrftoken=x' });
  const runner = new SubmissionRunner({ registry: makeRegistry(adapter), credentialStore: creds });
  await runner.run({ platform: 'leetcode-cn', problemId: '1', lang: 'cpp', code: '...', minIntervalMs: 5000 });
  await assert.rejects(
    () =>
      runner.run({ platform: 'leetcode-cn', problemId: '1', lang: 'cpp', code: '...', minIntervalMs: 5000 }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'RATE_LIMITED',
  );
});

test('SubmissionRunner: 跨平台不互锁', async () => {
  const adapter = {
    submit: async () => '1',
    pollResult: async () => judgeResult(),
  };
  const creds = new SecretCredentialStore(new MemorySecretBackend());
  await creds.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'csrftoken=x' });
  await creds.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=y' });
  const runner = new SubmissionRunner({ registry: makeRegistry(adapter), credentialStore: creds });
  await runner.run({ platform: 'leetcode-cn', problemId: '1', lang: 'cpp', code: '...', minIntervalMs: 5000 });
  // 立刻 hdoj 提交不被阻塞
  await runner.run({ platform: 'hdoj', problemId: '1000', lang: 'cpp', code: '...', minIntervalMs: 5000 });
});

test('SubmissionRunner: pollResult JUDGING_TIMEOUT 透传', async () => {
  const adapter = {
    submit: async () => '1',
    pollResult: async () => {
      throw new AdapterError('JUDGING_TIMEOUT', 'timeout', false);
    },
  };
  const creds = new SecretCredentialStore(new MemorySecretBackend());
  await creds.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'x' });
  const runner = new SubmissionRunner({ registry: makeRegistry(adapter), credentialStore: creds });
  await assert.rejects(
    () =>
      runner.run({ platform: 'leetcode-cn', problemId: '1', lang: 'cpp', code: '...' }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'JUDGING_TIMEOUT',
  );
});

test('SubmissionRunner: 普通 Error 被包装为 PLATFORM_ERROR', async () => {
  const adapter = {
    submit: async () => {
      throw new Error('unexpected');
    },
  };
  const creds = new SecretCredentialStore(new MemorySecretBackend());
  await creds.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'x' });
  const runner = new SubmissionRunner({ registry: makeRegistry(adapter), credentialStore: creds });
  await assert.rejects(
    () =>
      runner.run({ platform: 'leetcode-cn', problemId: '1', lang: 'cpp', code: '...' }),
    (e: Error) => {
      if (!(e instanceof AdapterError)) return false;
      return (e as AdapterError).code === 'PLATFORM_ERROR' && (e as AdapterError).source instanceof Error;
    },
  );
});

test('SubmissionRunner: signal 已 abort 立即拒绝', async () => {
  const adapter = {
    submit: async () => '1',
    pollResult: async () => judgeResult(),
  };
  const creds = new SecretCredentialStore(new MemorySecretBackend());
  await creds.set('leetcode-cn', { platform: 'leetcode-cn', cookie: 'x' });
  const runner = new SubmissionRunner({ registry: makeRegistry(adapter), credentialStore: creds });
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () =>
      runner.run({ platform: 'leetcode-cn', problemId: '1', lang: 'cpp', code: '...', signal: ctrl.signal }),
    (e: Error) => e instanceof AdapterError && (e as AdapterError).code === 'NETWORK_ERROR',
  );
});

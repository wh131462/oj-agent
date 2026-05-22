## ADDED Requirements

### Requirement: SubmissionRunner 接口

`@oj-agent/core` SHALL 提供 `SubmissionRunner` 类,封装"提交 + 轮询"编排:

```ts
interface SubmissionRunInput {
  platform: PlatformId;
  problemId: string;
  lang: string;
  code: string;
  minIntervalMs?: number;   // 默认 5000
  pollTimeoutMs?: number;   // 默认 60000
  onProgress?: (state: SubmissionProgress) => void;
  signal?: AbortSignal;
}
type SubmissionProgress =
  | { stage: 'pre-check' }
  | { stage: 'submitting' }
  | { stage: 'judging'; partial?: PlatformJudgeResult }
  | { stage: 'done'; result: PlatformJudgeResult };

class SubmissionRunner {
  constructor(deps: { registry: PlatformAdapterRegistry; credentialStore: CredentialStore });
  run(input: SubmissionRunInput): Promise<PlatformJudgeResult>;
}
```

#### Scenario: 完整流程
- **WHEN** 已登录,正常提交并 AC,`onProgress` 不为空
- **THEN** `onProgress` 依次被以 `'pre-check' → 'submitting' → 'judging'(N 次) → 'done'` 调用;最终返回 verdict=AC

### Requirement: 登录前置校验

`run` MUST 在 `stage: 'pre-check'` 之后立刻检查 `credentialStore.get(platform)`,不存在 SHALL 抛 `AdapterError('AUTH_REQUIRED')`,MUST NOT 调用 `adapter.submit`。

#### Scenario: 未登录拦截
- **WHEN** `credentialStore.get('hdoj')` 返回 undefined,调 `run({ platform: 'hdoj', ... })`
- **THEN** 抛 `AdapterError('AUTH_REQUIRED')`,`onProgress` 仅触发 `'pre-check'` 一次,无 `'submitting'`

### Requirement: 最小提交间隔

`SubmissionRunner` SHALL 在进程内维护 `Map<PlatformId, lastSubmitAt>`;距上次同平台 submit < `minIntervalMs`(默认 5000) MUST 抛 `AdapterError('RATE_LIMITED', '请稍后重试 (剩余 <x>s)')`,MUST NOT 调用适配器。

#### Scenario: 间隔不足
- **WHEN** 同平台 2 秒内连续 `run` 两次,`minIntervalMs: 5000`
- **THEN** 第二次抛 `AdapterError('RATE_LIMITED')`,message 含剩余秒数

#### Scenario: 间隔足够
- **WHEN** 同平台 6 秒后再 `run`,`minIntervalMs: 5000`
- **THEN** 正常出网,`lastSubmitAt` 更新

#### Scenario: 跨平台不互锁
- **WHEN** `run({ platform: 'leetcode-cn' })` 后立即 `run({ platform: 'hdoj' })`
- **THEN** HDOJ 提交不受 LeetCode CN 时间戳影响

### Requirement: 提交与轮询编排

`run` SHALL 顺序执行:
1. emit `{ stage: 'pre-check' }`
2. 登录校验 + 间隔校验
3. emit `{ stage: 'submitting' }`
4. `const sid = await adapter.submit(...)`,失败原样抛 `AdapterError`
5. emit `{ stage: 'judging' }`
6. `const final = await adapter.pollResult(sid)`(适配器内已实现退避 + 60s 超时);轮询期间通过 `onProgress({ stage: 'judging', partial })` 转发中间态(若适配器支持回调)
7. emit `{ stage: 'done', result: final }`,返回 `final`

#### Scenario: submit 失败
- **WHEN** `adapter.submit` 抛 `AdapterError('AUTH_EXPIRED')`
- **THEN** `run` 原样抛该错;`onProgress` 序列 `'pre-check' → 'submitting'`,无 `'judging'`

#### Scenario: pollResult 超时
- **WHEN** `adapter.pollResult` 抛 `AdapterError('JUDGING_TIMEOUT')`
- **THEN** `run` 原样抛;`onProgress` 序列含 `'pre-check' → 'submitting' → 'judging'`,无 `'done'`

### Requirement: AbortSignal 支持

`run` 接受 `signal?: AbortSignal`;abort 触发 MUST 在最近的 awaitable 处立即 reject 为 `AbortError`,且 MUST 不再调用 `adapter.pollResult`。已发起的 submit MUST 不撤销(无法回滚)。

#### Scenario: 轮询期间 abort
- **WHEN** `signal.abort()` 在第 2 次轮询时触发
- **THEN** `run` reject 为 `AbortError`,`onProgress` 不再被调用

### Requirement: 错误透传

`run` 拒绝路径 MUST 抛出 `AdapterError`(包括 `AbortError` 之外的所有错误);如果适配器抛了非 `AdapterError`,SHALL 包装为 `AdapterError('PLATFORM_ERROR', e.message, false, e)`。

#### Scenario: 适配器抛普通 Error
- **WHEN** `adapter.submit` 抛 `new Error('unexpected')`
- **THEN** `run` 抛 `AdapterError('PLATFORM_ERROR')`,`source` 指向原 Error

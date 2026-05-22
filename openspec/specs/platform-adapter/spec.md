# platform-adapter Specification

## Purpose

定义 `@oj-agent/core` 中 OJ 平台适配器的统一契约 `PlatformAdapter`、注册装配 `PlatformAdapterRegistry`、错误归一化 `AdapterError` 与适配器实现的零 VSCode 依赖约束。

## Requirements

### Requirement: PlatformAdapter 契约

`@oj-agent/core` SHALL 在 `platform/adapter.ts` 中提供 `PlatformAdapter` 接口,所有具体平台适配器 MUST 实现该接口。接口形态(沿用 `add-monorepo-layout` 已落地的类型):

```ts
interface PlatformAdapter {
  readonly id: PlatformId;
  login(): Promise<PlatformCredential>;
  listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]>;
  getProblem(id: string): Promise<PlatformProblemDetail>;
  submit(id: string, lang: string, code: string): Promise<PlatformSubmissionId>;
  pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult>;
}
```

#### Scenario: 类型契约稳定
- **WHEN** 编译 `@oj-agent/core` 与下游 `@oj-agent/cli` / `oj-agent` 包
- **THEN** `import type { PlatformAdapter } from '@oj-agent/core'` 成功;接口签名与 `add-monorepo-layout` 落地版本一致

#### Scenario: 实现类完整方法
- **WHEN** 实现 `LeetCodeCnAdapter` / `HDOJAdapter`
- **THEN** TypeScript 类型检查通过,所有 5 个方法均存在且签名匹配

### Requirement: PlatformAdapterRegistry 装配

`@oj-agent/core` SHALL 提供 `PlatformAdapterRegistry` 类,负责创建并缓存平台适配器实例。Registry 构造时 MUST 注入 `{ httpClient, credentialStore, rateLimiter }`,并将这些依赖按 `platformId` 透传给各适配器。

#### Scenario: 按 id 取实例
- **WHEN** 调用 `registry.get('leetcode-cn')`
- **THEN** 返回 `LeetCodeCnAdapter` 实例,且后续同 id 调用返回同一实例(引用相等)

#### Scenario: 不支持的平台
- **WHEN** 调用 `registry.get('unknown' as PlatformId)`
- **THEN** 抛出 `Error`,信息包含 `'unknown'`

### Requirement: AdapterError 归一化

`@oj-agent/core` SHALL 定义 `AdapterError` 类与 `AdapterErrorCode` 联合类型。所有适配器方法的拒绝路径 MUST 抛出 `AdapterError` 而非原始 `Error / TypeError / FetchError`。

```ts
type AdapterErrorCode =
  | 'NETWORK_ERROR' | 'AUTH_REQUIRED' | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'  | 'PARSE_ERROR'   | 'PLATFORM_ERROR'
  | 'LANG_UNSUPPORTED' | 'NOT_FOUND'  | 'JUDGING_TIMEOUT';
class AdapterError extends Error {
  constructor(public code: AdapterErrorCode, message: string,
              public retriable: boolean, public source?: unknown);
}
```

#### Scenario: 未登录时调用写操作
- **WHEN** `credentialStore` 中无 `oj.cookie.leetcode-cn`,调用 `adapter.submit(...)`
- **THEN** 抛 `AdapterError` 且 `code === 'AUTH_REQUIRED'`,`retriable === false`

#### Scenario: 网络错误透传
- **WHEN** `HttpClient` 抛 `AdapterError('NETWORK_ERROR')`
- **THEN** 适配器方法直接 rethrow,MUST NOT 包装为新错误

### Requirement: 适配器内部状态隔离

每个 `PlatformAdapter` 实例 SHALL 只在自身范围内缓存平台细节(如 LeetCode CN 的 `csrftoken`、HDOJ 当前 `username`),MUST NOT 通过全局变量、模块级 `let`、`process.env` 等方式共享状态。

#### Scenario: 多 Registry 并存不互染
- **WHEN** 测试中创建两个 `PlatformAdapterRegistry` 实例(不同的 `credentialStore`)
- **THEN** 各自的 `LeetCodeCnAdapter` 实例独立缓存 csrftoken,不互相覆盖

### Requirement: 适配器零 VSCode 依赖

所有平台适配器实现文件 MUST NOT 直接 import `'vscode'`、MUST NOT 引用任何 `vscode.*` API。

#### Scenario: grep 验证
- **WHEN** 在 `packages/core/src/platform/` 下执行 `grep -r "from 'vscode'"` 与 `grep -r "import.*vscode"`
- **THEN** 无匹配项

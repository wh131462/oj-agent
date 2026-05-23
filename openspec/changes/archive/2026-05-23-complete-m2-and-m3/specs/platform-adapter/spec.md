## ADDED Requirements

### Requirement: 适配器声明能力矩阵

`PlatformAdapter` SHALL 暴露只读 `capabilities` 字段,声明 `listing`、`detail`、`submit`、`poll` 各能力的认证需求,枚举值为 `'public' | 'auth-required' | 'unsupported'`。

```ts
interface PlatformAdapter {
  readonly id: PlatformId;
  readonly capabilities: {
    listing: 'public' | 'auth-required' | 'unsupported';
    detail:  'public' | 'auth-required' | 'unsupported';
    submit:  'public' | 'auth-required' | 'unsupported';
    poll:    'public' | 'auth-required' | 'unsupported';
  };
  readonly degraded?: { reason: string; affected: Array<'listing'|'detail'|'submit'|'poll'> };
  // ... 其他方法保持不变
}
```

#### Scenario: LeetCode CN 默认能力
- **WHEN** 读取 `leetcodeCnAdapter.capabilities`
- **THEN** `listing/detail` 为 `'public'`,`submit/poll` 为 `'auth-required'`,`degraded` 为 `undefined`

#### Scenario: 蓝桥云课降级能力
- **WHEN** 读取 `lanqiaoAdapter.capabilities`
- **THEN** `listing` 为 `'public'`,`detail/submit` 为 `'auth-required'`;`degraded.affected` 含 `'detail'` 与 `'submit'`,`degraded.reason` 非空

### Requirement: 前端依据能力矩阵决定 UI 展示

CLI 与 VSCode 前端 SHALL 在调用适配器方法前读取 `capabilities`/`degraded`,据此显示登录前置提示或降级标记;前端 MUST NOT 在未提示用户的情况下静默失败。

#### Scenario: 列表前判断登录需求
- **WHEN** 用户在前端选择 `lanqiao` 平台浏览详情,但未登录
- **THEN** 前端基于 `capabilities.detail === 'auth-required'` 弹出登录提示,不直接发起 `getProblem` 请求

## MODIFIED Requirements

### Requirement: PlatformAdapter 契约

`@oj-agent/core` SHALL 在 `platform/adapter.ts` 中提供 `PlatformAdapter` 接口,所有具体平台适配器 MUST 实现该接口。接口形态(沿用 `add-monorepo-layout` 已落地的类型,并新增 `capabilities` 与可选 `degraded` 字段):

```ts
interface PlatformAdapter {
  readonly id: PlatformId;
  readonly capabilities: PlatformCapabilities;
  readonly degraded?: PlatformDegradedInfo;
  login(): Promise<PlatformCredential>;
  listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]>;
  getProblem(id: string): Promise<PlatformProblemDetail>;
  submit(id: string, lang: string, code: string): Promise<PlatformSubmissionId>;
  pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult>;
}
```

现有 `LeetCodeCnAdapter` / `HDOJAdapter` MUST 在不改变行为的前提下补充 `capabilities` 字段。

#### Scenario: 类型契约稳定
- **WHEN** 编译 `@oj-agent/core` 与下游 `@oj-agent/cli` / `oj-agent` 包
- **THEN** `import type { PlatformAdapter } from '@oj-agent/core'` 成功;接口除新增 `capabilities`/`degraded` 外保持向后兼容

#### Scenario: 实现类完整方法
- **WHEN** 实现 `LeetCodeCnAdapter` / `HDOJAdapter` / `CodeforcesAdapter` / `LuoguAdapter` / `POJAdapter` / `LanqiaoAdapter`
- **THEN** TypeScript 类型检查通过,所有方法与必填字段均存在且签名匹配

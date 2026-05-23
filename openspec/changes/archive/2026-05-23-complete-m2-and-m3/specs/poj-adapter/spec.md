## ADDED Requirements

### Requirement: POJ 适配器实现 PlatformAdapter

`@oj-agent/core` SHALL 在 `platform/poj/index.ts` 中提供 `POJAdapter` 类,实现 [[platform-adapter]] 的 `PlatformAdapter` 接口,`id` 为 `'poj'`。

#### Scenario: 注册到 Registry
- **WHEN** 调用 `registry.get('poj')`
- **THEN** 返回 `POJAdapter` 实例

#### Scenario: 零 VSCode 依赖
- **WHEN** 在 `packages/core/src/platform/poj/` 下 grep `from 'vscode'`
- **THEN** 无匹配项

### Requirement: HTML 爬取 + GBK 转码

`POJAdapter` SHALL 抓取 `http://poj.org/problemlist`(列表)与 `http://poj.org/problem?id={id}`(题面),响应使用 GBK 编码,MUST 通过 [[http-client]] 自动 `iconv-lite` 转码为 UTF-8 后再解析。

#### Scenario: 列表分页
- **WHEN** 调用 `adapter.listProblems({ page: 1 })`
- **THEN** 返回 100 题/页,字段含 `id / title / ratio / date`

#### Scenario: 题面解析含 GBK 中文
- **WHEN** 调用 `adapter.getProblem('1000')`
- **THEN** `content` 包含正确的中文/英文字符(经 GBK→UTF-8 转码),含 `Description / Input / Output / Sample Input / Sample Output / Hint`

### Requirement: 慢响应的超时与重试策略

`POJAdapter` SHALL 通过 [[http-client]] 的平台配置表声明默认超时 **30s** 与最多 **1 次重试**,该值 MUST 显著高于其他平台默认值。

#### Scenario: 超时配置生效
- **WHEN** 创建 `POJAdapter` 实例
- **THEN** 内部请求使用 30s 超时;若首次超时,自动重试一次,仍失败则抛 `AdapterError` 且 `code === 'NETWORK_ERROR'`、`retriable === true`

### Requirement: 提交与轮询

`POJAdapter.submit` SHALL 使用表单 POST `http://poj.org/submit?problem_id={id}` 在已登录会话下提交;`pollResult` 通过用户提交记录页解析判题状态。

#### Scenario: 成功提交
- **WHEN** 调用 `adapter.submit('1000', 'cpp', code)`
- **THEN** 返回 `PlatformSubmissionId`

#### Scenario: 未登录
- **WHEN** 无 POJ 会话
- **THEN** 抛 `AdapterError` 且 `code === 'AUTH_REQUIRED'`

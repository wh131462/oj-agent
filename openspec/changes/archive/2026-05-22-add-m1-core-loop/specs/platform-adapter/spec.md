## ADDED Requirements

### Requirement: 适配器统一接口

系统 SHALL 定义 `PlatformAdapter` 接口，所有 OJ 平台实现 MUST 遵循该接口。接口 MUST 暴露以下能力：`listProblems(query)`、`getProblem(id)`、`submit(id, lang, code)`、`pollResult(submissionId, onProgress?)`、`getLoginStatus()`、`logout()`。适配器 MUST 通过构造函数注入 `HttpClient` 与 `CredentialStore`，不允许自行读取全局配置。

#### Scenario: 通过工厂获取平台适配器

- **WHEN** 上层调用 `PlatformAdapterRegistry.get('leetcode-cn')`
- **THEN** 返回已注入 HttpClient 与 CredentialStore 的 `LeetCodeCnAdapter` 实例，且实例 SHALL 实现 `PlatformAdapter` 全部方法

#### Scenario: 适配器无登录态时拒绝提交

- **WHEN** 上层未登录情况下调用 `adapter.submit(...)`
- **THEN** 适配器 MUST 抛出 `AdapterError { code: 'UNAUTHENTICATED', retriable: false }`，不发起网络请求

### Requirement: 错误归一化

所有适配器返回的失败 MUST 归一化为 `AdapterError { code, message, retriable, source, cause? }`。`code` MUST 在以下枚举内：`UNAUTHENTICATED`、`NETWORK`、`RATE_LIMITED`、`NOT_FOUND`、`PARSE_FAILED`、`PLATFORM_ERROR`、`TIMEOUT`、`UNKNOWN`。UI 层 MUST 仅依据 `code` 决定提示与降级行为。

#### Scenario: HTTP 429 归一化为 RATE_LIMITED

- **WHEN** 平台返回 HTTP 429
- **THEN** 适配器 MUST 抛出 `AdapterError { code: 'RATE_LIMITED', retriable: true }`，并将原始响应放入 `cause`

#### Scenario: HTML 解析失败归一化为 PARSE_FAILED

- **WHEN** HDOJ 适配器抓取题面后 `cheerio` 未匹配到样例选择器
- **THEN** 抛出 `AdapterError { code: 'PARSE_FAILED', retriable: false, message: '样例解析失败' }`

### Requirement: 数据模型

适配器 MUST 使用统一的数据结构：`ProblemSummary { platform, id, slug, title, difficulty, tags[], updatedAt }`、`ProblemDetail`（含 `markdown`、`samples[]`、`codeSnippets{lang: string}`、`limits{timeMs, memoryMb}`、`metadata`）、`SubmissionId { platform, raw }`、`JudgeResult { state, verdict, timeMs?, memoryKb?, message?, detail? }`。`verdict` MUST 在枚举内：`AC`、`WA`、`TLE`、`MLE`、`RE`、`CE`、`PE`、`OLE`、`PENDING`、`UNKNOWN`。

#### Scenario: 不同平台返回相同结构

- **WHEN** 分别调用 `leetcodeCnAdapter.getProblem(...)` 与 `hdojAdapter.getProblem(...)`
- **THEN** 两者 SHALL 返回字段集合完全一致的 `ProblemDetail` 对象，差异仅体现在字段值

### Requirement: 列表查询契约

`listProblems(query)` MUST 接受 `{ page, pageSize, keyword?, difficulty?, tags?[] }` 并返回 `{ items: ProblemSummary[], total, page, pageSize }`。当平台不支持某种筛选时，适配器 MUST 在本地完成过滤而不是默默忽略参数。

#### Scenario: HDOJ 本地过滤难度

- **WHEN** 上层调用 `hdojAdapter.listProblems({ page:1, pageSize:50, difficulty:'easy' })`
- **THEN** 适配器拉取列表后按本地规则过滤难度，返回结果 `items` 全部满足条件，`total` 反映过滤后总数

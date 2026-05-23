## ADDED Requirements

### Requirement: Codeforces 适配器实现 PlatformAdapter

`@oj-agent/core` SHALL 在 `platform/codeforces/index.ts` 中提供 `CodeforcesAdapter` 类,实现 [[platform-adapter]] 定义的 `PlatformAdapter` 接口,`id` 为 `'codeforces'`。

#### Scenario: 注册到 Registry
- **WHEN** 调用 `registry.get('codeforces')`
- **THEN** 返回 `CodeforcesAdapter` 实例,后续相同调用引用相等

#### Scenario: 零 VSCode 依赖
- **WHEN** 在 `packages/core/src/platform/codeforces/` 下 grep `from 'vscode'`
- **THEN** 无匹配项

### Requirement: 题目列表来自官方 API

`CodeforcesAdapter.listProblems` SHALL 调用 `https://codeforces.com/api/problemset.problems`,返回字段 MUST 至少包含 `contestId / index / name / tags / rating / solvedCount`。

#### Scenario: 列表拉取成功
- **WHEN** 调用 `adapter.listProblems({ limit: 100 })`
- **THEN** 返回 `PlatformProblemSummary[]`,每项 `id` 形如 `"1900A"`(contestId + index),`difficulty` 映射自 `rating`

#### Scenario: 标签过滤
- **WHEN** 调用 `adapter.listProblems({ tags: ['dp'] })`
- **THEN** 请求 URL 携带 `tags=dp`,返回结果全部带 `dp` 标签

### Requirement: 题面通过登录会话抓取 HTML 解析

`CodeforcesAdapter.getProblem` SHALL 使用 [[http-client]] 的 `withSession('codeforces')` 注入登录 Cookie 与浏览器化请求头,抓取 `/contest/{id}/problem/{idx}` 或 `/problemset/problem/{id}/{idx}`,解析 `.problem-statement` 节点为题面 Markdown。

#### Scenario: 已登录抓取题面
- **WHEN** 凭证库中存在 Codeforces 会话,调用 `adapter.getProblem('1900A')`
- **THEN** 返回 `PlatformProblemDetail`,含 `content`(Markdown)、`samples`(input/output 对)、`timeLimit`、`memoryLimit`

#### Scenario: 命中 Cloudflare 拦截
- **WHEN** 响应 HTML 含 `cf-turnstile` 或 "安全验证" 字样
- **THEN** 抛 `AdapterError` 且 `code === 'AUTH_REQUIRED'`,message 提示用户在浏览器完成验证后重试

### Requirement: 提交与轮询

`CodeforcesAdapter.submit` SHALL 通过登录会话提交代码,返回 `PlatformSubmissionId`;`pollResult` SHALL 轮询 `/api/user.status` 或提交状态页,解析判题结果并归一化为 `PlatformJudgeResult`。提交完成后 MUST 在结果中带上提交记录页 URL,供前端兜底打开。

#### Scenario: 成功提交
- **WHEN** 调用 `adapter.submit('1900A', 'cpp17', code)`
- **THEN** 返回提交 ID,凭证失效时抛 `AUTH_EXPIRED`

#### Scenario: 轮询出最终结果
- **WHEN** 调用 `adapter.pollResult(sid)` 至判题完成
- **THEN** 返回 `PlatformJudgeResult`,字段含 `verdict / time / memory / detailUrl`

## ADDED Requirements

### Requirement: 洛谷适配器实现 PlatformAdapter

`@oj-agent/core` SHALL 在 `platform/luogu/index.ts` 中提供 `LuoguAdapter` 类,实现 [[platform-adapter]] 的 `PlatformAdapter` 接口,`id` 为 `'luogu'`。

#### Scenario: 注册到 Registry
- **WHEN** 调用 `registry.get('luogu')`
- **THEN** 返回 `LuoguAdapter` 实例

#### Scenario: 零 VSCode 依赖
- **WHEN** 在 `packages/core/src/platform/luogu/` 下 grep `from 'vscode'`
- **THEN** 无匹配项

### Requirement: 通过 lentille-context 解析列表与题面

`LuoguAdapter` SHALL 拉取 `/problem/list` 与 `/problem/{pid}` 页面,解析 `<script id="lentille-context" type="application/json">` 中的 JSON 取得列表与题面数据,MUST NOT 调用 `?_contentOnly=1` 等不稳定接口。

#### Scenario: 列表解析
- **WHEN** 调用 `adapter.listProblems({ page: 1 })`
- **THEN** 解析 `lentille-context.data.problems.result[]`,返回 `PlatformProblemSummary[]`,字段含 `pid / name / difficulty / tags / totalAccepted`

#### Scenario: 题面解析
- **WHEN** 调用 `adapter.getProblem('P1001')`
- **THEN** 返回 `PlatformProblemDetail`,`content` 为 Markdown(含 LaTeX),来自 `lentille-context.data.problem.contenu.content`

#### Scenario: 页面结构变化降级
- **WHEN** `lentille-context` 节点缺失或 JSON schema 校验失败
- **THEN** 抛 `AdapterError` 且 `code === 'PARSE_ERROR'`,message 包含失败字段路径

### Requirement: 提交携带 CSRF Token

`LuoguAdapter.submit` SHALL 在 POST 前从题目详情页 `<meta name="csrf-token">` 解析 token,并随表单提交。

#### Scenario: 成功提交
- **WHEN** 调用 `adapter.submit('P1001', 'cpp17', code)` 且已登录
- **THEN** 请求体含 csrf token,返回 `PlatformSubmissionId`

#### Scenario: 未登录提交
- **WHEN** 凭证库中无洛谷会话
- **THEN** 抛 `AdapterError` 且 `code === 'AUTH_REQUIRED'`

#### Scenario: 易盾验证拦截
- **WHEN** 响应含易盾验证标记
- **THEN** 抛 `AdapterError` 且 `code === 'AUTH_REQUIRED'`,提示用户在浏览器完成验证

### Requirement: 轮询判题结果

`LuoguAdapter.pollResult` SHALL 通过提交记录页或对应接口拉取判题状态,归一化为 `PlatformJudgeResult`。

#### Scenario: 轮询直至完成
- **WHEN** 调用 `adapter.pollResult(sid)`
- **THEN** 在判题完成前返回 `status: 'judging'`,完成后返回 `verdict / time / memory`

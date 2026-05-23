## ADDED Requirements

### Requirement: 蓝桥云课适配器实现 PlatformAdapter

`@oj-agent/core` SHALL 在 `platform/lanqiao/index.ts` 中提供 `LanqiaoAdapter` 类,实现 [[platform-adapter]] 的 `PlatformAdapter` 接口,`id` 为 `'lanqiao'`。

#### Scenario: 注册到 Registry
- **WHEN** 调用 `registry.get('lanqiao')`
- **THEN** 返回 `LanqiaoAdapter` 实例

#### Scenario: 零 VSCode 依赖
- **WHEN** 在 `packages/core/src/platform/lanqiao/` 下 grep `from 'vscode'`
- **THEN** 无匹配项

### Requirement: 公共列表无需认证

`LanqiaoAdapter.listProblems` SHALL 调用 `https://www.lanqiao.cn/api/v2/problems/?limit=N&offset=M` 拉取列表,不需要登录,返回字段至少包含 `id / title / tags / difficulty`。

#### Scenario: 匿名拉取列表
- **WHEN** 凭证库中无蓝桥会话,调用 `adapter.listProblems({ limit: 50 })`
- **THEN** 成功返回 `PlatformProblemSummary[]`,不抛错

### Requirement: 详情与提交需 JWT 并支持能力降级

`LanqiaoAdapter.getProblem` 与 `submit` SHALL 在请求头携带 JWT 访问 `/api/v2/problems/{id}/` 与提交接口。未登录或 401/403 时 MUST 抛 `AdapterError` 且 `code === 'AUTH_REQUIRED'`,message 明确告知 "详情/提交需登录蓝桥云课"。

#### Scenario: 未登录取详情
- **WHEN** 无蓝桥 JWT 凭证,调用 `adapter.getProblem('123')`
- **THEN** 抛 `AdapterError` 且 `code === 'AUTH_REQUIRED'`

#### Scenario: 已登录取详情
- **WHEN** 凭证库中存在有效 JWT,调用 `adapter.getProblem('123')`
- **THEN** 返回 `PlatformProblemDetail`

### Requirement: 适配器声明能力降级标识

`LanqiaoAdapter` SHALL 通过 [[platform-adapter]] 新增的 `capabilities` / `degraded` 字段声明:`listing: 'public'`,`detail: 'auth-required'`,`submit: 'auth-required'`,`degraded.affected = ['detail','submit']`,`degraded.reason` 说明 "蓝桥云课偏在线 IDE,本地工作流仅支持公开列表与登录后的详情/提交"。

#### Scenario: 能力矩阵
- **WHEN** 调用 `adapter.capabilities`
- **THEN** 字段值与上述描述一致;CLI `oja platforms` 与 VSCode UI 据此显示降级提示

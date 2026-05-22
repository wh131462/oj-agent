## ADDED Requirements

### Requirement: 一键提交

系统 SHALL 提供命令 `OJ-Agent: 提交当前代码`，触发后 MUST：
1. 由当前编辑器活动文件解析所属题目目录与平台。
2. 校验登录态、未登录则跳转 `auth-manager` 登录流程。
3. 调用对应适配器 `submit(id, lang, code)`。
4. 立即进入轮询并展示状态栏与结果面板。

#### Scenario: 未登录时拦截

- **WHEN** 当前题目对应平台未登录
- **THEN** 系统 SHALL 阻止提交，弹出登录入口，且不计入限速

### Requirement: 语言映射

系统 SHALL 在执行 `submit` 前将本地语言（`cpp/python/java/javascript`）映射到平台语言 ID（由适配器维护）。映射失败 MUST 弹出错误并阻止提交。

#### Scenario: HDOJ 提交 JS 被拒

- **WHEN** 当前文件是 `solution.js` 且平台为 HDOJ
- **THEN** 系统提示「HDOJ 不支持 JavaScript」并阻止提交

### Requirement: 提交后轮询

系统 SHALL 启动 `pollResult`，使用指数退避序列 `[1000, 2000, 3000, 5000, 5000, 5000, ...]`，总超时由 `ojAgent.submission.pollTimeoutMs` 配置，默认 60000。每次轮询拿到 `state` 变化 MUST 通过 `onProgress` 更新结果面板与状态栏。

#### Scenario: 状态变化实时反馈

- **WHEN** pollResult 依次返回 `PENDING → COMPILING → JUDGING → AC`
- **THEN** 状态栏依次显示 `Judging…(待评) → Judging…(编译) → Judging…(评测) → ✓ AC 24ms`

### Requirement: 状态栏

系统 SHALL 在 VSCode 状态栏维护一个评测项 `OJ-Agent: Judging`，仅在评测进行中显示，结束后 5 秒切换为最终 verdict 简短文本，再 10 秒后自动隐藏。点击 MUST 打开结果面板。

#### Scenario: 提交后显示评测中

- **WHEN** 提交成功且 `pollResult` 启动
- **THEN** 状态栏立即显示 `OJ-Agent: Judging…`，配合 `$(loading~spin)` 图标

### Requirement: 结果展示

系统 SHALL 在结果面板中显示最终 verdict、耗时、内存、平台提交 ID 链接（点击在外部浏览器打开平台提交页），并对 `WA` 提供「在线查看测试点」按钮（仅 LeetCode CN，HDOJ 不提供）。

#### Scenario: 编译错误显示详细信息

- **WHEN** verdict=CE 且 `detail.full_compile_error` 存在
- **THEN** 结果面板 SHALL 完整展示编译错误文本（保持原换行与缩进）

### Requirement: 限速与提交风险

系统 SHALL 强制全局提交最小间隔（默认 5 秒，可由 `ojAgent.submission.minIntervalMs` 配置）。在最小间隔内重复触发提交 MUST 弹出确认对话框「上次提交在 X 秒前，是否继续？」用户确认后才发起。

#### Scenario: 短时间连续提交

- **WHEN** 上次提交完成 2 秒后用户再次触发提交，最小间隔 5 秒
- **THEN** 系统弹出确认对话框，未确认前不发请求

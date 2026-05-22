## ADDED Requirements

### Requirement: 状态栏聚合项

扩展 SHALL 创建一个 StatusBarItem(`StatusBarAlignment.Left`, priority 100),text 默认 `'$(rocket) OJ-Agent'`,tooltip 列出各平台登录状态(`'leetcode-cn: ✓\\nhdoj: ✗'`)。点击 MUST 触发 `ojAgent.statusBar.openQuickPick`。

当 `ojAgent.platforms.enabled === []` 时 StatusBarItem MUST 隐藏。

#### Scenario: 默认显示
- **WHEN** 扩展激活且 platforms.enabled 非空
- **THEN** 状态栏显示 `🚀 OJ-Agent`

#### Scenario: 平台禁用时隐藏
- **WHEN** 用户把 `ojAgent.platforms.enabled` 设为 `[]`
- **THEN** 状态栏项消失

### Requirement: 提交进度反馈

当 `SubmissionRunner.run` 触发 `stage: 'submitting'` 时,状态栏 text SHALL 切换为 `'$(sync~spin) Submitting…'`;`stage: 'judging'` 时切到 `'$(sync~spin) Judging…'`;`stage: 'done'` 时按 verdict 切到带 verdict 短文本:
- AC → `'$(check) AC <ms>ms'`
- WA / RE / TLE / MLE / PE → `'$(error) <verdict>'`
- CE → `'$(error) CE'`
- UNKNOWN / 其他 → `'$(question) <verdict>'`

verdict 文本 MUST 在 5 秒后切回默认 `'$(rocket) OJ-Agent'`,再 10 秒后(总 15 秒后)恢复 tooltip 的常规登录状态。

#### Scenario: 提交序列
- **WHEN** 提交后依次收到 submitting / judging / done(AC, 120ms)
- **THEN** 状态栏文本依次为 `Submitting… → Judging… → ✓ AC 120ms`(5s 后恢复 `OJ-Agent`)

#### Scenario: WA 闪烁后恢复
- **WHEN** done verdict=WA
- **THEN** 状态栏 5s 显示 `❌ WA`,之后恢复默认

### Requirement: QuickPick 入口

`ojAgent.statusBar.openQuickPick` SHALL 弹 QuickPick,选项至少包含:
- `登录...`(子 QuickPick 选平台,等同 `ojAgent.auth.login`)
- `登出...`(等同 `ojAgent.auth.logout`)
- `重新登录...`
- `切换工作区根目录`(等同 `ojAgent.workspace.setRoot`)
- `打开 OutputChannel`
- `查看工具链`(等同 `ojAgent.judge.openToolchain`)

#### Scenario: 入口存在
- **WHEN** 点击状态栏 → QuickPick 弹出
- **THEN** 上述至少 6 个选项均可见;每个选项点击都路由到对应命令

### Requirement: 登录态变更同步

`CredentialStore.onChange` 触发时,状态栏 SHALL 在 500ms 内更新 tooltip(各平台登录状态)与 TreeView 平台节点的 iconPath。

#### Scenario: 登录后状态栏同步
- **WHEN** 完成 LeetCode CN 登录
- **THEN** 状态栏 tooltip 中 `leetcode-cn` 行变为 `✓`,TreeView 该节点图标变 `$(account)`

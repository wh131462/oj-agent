## ADDED Requirements

### Requirement: 题库 TreeView 注册

VSCode 扩展 SHALL 在 `Activity Bar > OJ-Agent` 容器下注册视图 `ojAgent.problems`,显示名 `'题库'`。视图 MUST 与现有 `ojAgent.aiProfiles / ojAgent.aiActions` 并列、互不干扰。当 `ojAgent.platforms.enabled` 配置为空数组时,本视图 MUST 隐藏。

#### Scenario: 视图可见
- **WHEN** `ojAgent.platforms.enabled === ['leetcode-cn','hdoj']`
- **THEN** Activity Bar `OJ-Agent` 下能看到 `题库` 视图,展开后第一层为两个平台节点

#### Scenario: 视图隐藏
- **WHEN** `ojAgent.platforms.enabled === []`
- **THEN** `题库` 视图不出现在侧边栏

### Requirement: 两层结构与图标

TreeView 第一层 SHALL 为平台节点,label 取平台展示名(`LeetCode CN` / `HDOJ`),contextValue `platform-<id>`,iconPath 按登录状态:已登录 `$(account)`、未登录 `$(account-off)`、过期 `$(warning)`。

第二层 SHALL 为题目节点,label `'<id>. <title>'`,contextValue `problem-<platform>`,description 显示难度(`Easy/Medium/Hard`),iconPath 按难度上色(绿/橙/红)。点击该节点 MUST 触发"拉取并打开题面"动作(等同 `ojAgent.platform.pullProblem`)。

#### Scenario: 平台登录态切换刷新图标
- **WHEN** 用户执行 `ojAgent.auth.login` 完成 HDOJ 登录
- **THEN** TreeView HDOJ 节点的 iconPath 在 100ms 内从 `$(account-off)` 切换到 `$(account)`

#### Scenario: 难度图标
- **WHEN** 节点是 `LeetCode CN` 下的 Easy 题
- **THEN** 该节点 iconPath 为绿色调,description 文字 `Easy`

### Requirement: 筛选与分页工具栏

TreeView 工具栏(`menus.view/title`) SHALL 提供以下命令(均仅在 `view == ojAgent.problems` 时显示):

- `$(search)` `ojAgent.problems.search` —— QuickInput 输入关键字,确认后用作 `query.keyword`
- `$(filter)` `ojAgent.problems.filterDifficulty` —— QuickPick 选 `Any/Easy/Medium/Hard`,作为 `query.difficulty`
- `$(tag)` `ojAgent.problems.filterTags` —— QuickPick 多选标签(从最近一次拉取的列表中聚合)
- `$(arrow-left)` `ojAgent.problems.prevPage` —— page--,page 最小 1
- `$(arrow-right)` `ojAgent.problems.nextPage` —— page++
- `$(refresh)` `ojAgent.problems.refresh` —— 重新拉取当前页

筛选与分页状态 MUST 按平台分别持久化到 `workspaceState.get('ojAgent.problems.<platform>.query')`,扩展重启后保留。

#### Scenario: 筛选后查询透传
- **WHEN** 用户在 LeetCode CN 节点下设置关键字 `'两数'`、难度 `Easy`
- **THEN** 下一次 `adapter.listProblems` 调用的入参为 `{ keyword: '两数', difficulty: 'Easy', page: 1, pageSize: 50 }`

#### Scenario: 状态持久化
- **WHEN** 设置筛选后 reload 窗口
- **THEN** 重启后该平台筛选状态仍为 `'两数' / Easy`

### Requirement: 拉取右键菜单

第二层题目节点 SHALL 在 `menus.view/item/context` 注册右键命令(`when: viewItem == problem-<platform>`):
- `ojAgent.platform.pullProblem` `拉取到本地`(inline 也展示)
- `ojAgent.platform.openInBrowser` `在浏览器打开`
- `ojAgent.platform.copyProblemId` `复制题号`

#### Scenario: 右键拉取
- **WHEN** 用户右键 LeetCode `1. 两数之和` 点 `拉取到本地`
- **THEN** 触发 `ojAgent.platform.pullProblem({ platform: 'leetcode-cn', id: '1', slug: 'two-sum' })`,写盘后自动打开题面 Webview

### Requirement: 未登录时只读列表

LeetCode CN 节点 MUST 在未登录时仍可展开并显示题目列表(LeetCode CN 允许匿名读列表);HDOJ 节点 MUST 在未登录时仍可展开并显示题目列表(`listproblem.php` 不需登录)。但点击 `拉取到本地` 时,若需要登录态(LeetCode 部分题目需会员则提示用户登录);其它失败按 `AdapterError.code` 转换为可读 Notification。

#### Scenario: 匿名展开 LeetCode CN
- **WHEN** 未登录,展开 LeetCode CN
- **THEN** 列表正常显示,登录图标为 `$(account-off)`,无报错

#### Scenario: 提交需登录
- **WHEN** 未登录右键 `拉取到本地` 后点击工具栏"提交"
- **THEN** 弹 Notification `'请先登录 LeetCode CN'`,带按钮跳 `ojAgent.auth.login`

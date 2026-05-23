## ADDED Requirements

### Requirement: 设置面板暴露核心配置

VSCode 扩展 SHALL 在 `settings-panel.ts` Webview 中分组展示并允许编辑下列配置,所有写入 MUST 通过 `VSCodeConfigBackend.set` 持久化到 `vscode.workspace.getConfiguration('ojAgent')`:

- 工作区:`workspace.root`
- 网络:`network.requestIntervalMs`、`network.timeoutMs`、`network.proxy`
- 平台:每个平台的能力降级提示与登录入口入口按钮
- AI Profile:激活 Profile 的下拉选择(列表与编辑仍走 `oja ai profile` / 既有命令)

#### Scenario: 修改请求间隔生效
- **WHEN** 用户在设置面板把 `network.requestIntervalMs` 从 1000 改为 2000 并保存
- **THEN** `workspace.getConfiguration('ojAgent').get('network.requestIntervalMs') === 2000`,后续平台请求按新间隔限速

#### Scenario: 切换激活 AI Profile
- **WHEN** 用户在下拉中选择新 Profile
- **THEN** 配置写入 `ojAgent.ai.activeProfile`,AI 助手命令使用新 Profile,无需重启

#### Scenario: 平台降级提示展示
- **WHEN** 蓝桥云课适配器声明 `degraded`
- **THEN** 平台分组中显示 `degraded.reason` 文案与 "登录蓝桥云课" 按钮

### Requirement: 新平台 UI 集成

VSCode 扩展 SHALL 为 Codeforces / 洛谷 / POJ / 蓝桥云课 提供与 LeetCode CN / HDOJ 一致的 TreeView 节点、状态栏登录态展示与登录入口命令。新平台命令 ID 命名为 `ojAgent.<platform>.login`、`ojAgent.<platform>.logout`。

#### Scenario: TreeView 显示新平台
- **WHEN** 扩展激活后打开侧边栏
- **THEN** 平台分组列出全部 6 个平台,各自含 "题库" 与 "已拉取" 子节点

#### Scenario: 状态栏登录态
- **WHEN** 已登录 Codeforces,未登录洛谷
- **THEN** 状态栏显示 "CF✓ 洛谷✗" 等区分图标,点击后弹出登录入口

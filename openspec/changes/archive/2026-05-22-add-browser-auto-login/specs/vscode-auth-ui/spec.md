## MODIFIED Requirements

### Requirement: 登录命令分发

VSCode 扩展 SHALL 注册命令 `ojAgent.auth.login`、`ojAgent.auth.logout`、`ojAgent.auth.relogin`,均可接 `platformId?: PlatformId` 参数;不传时弹 QuickPick 让用户选平台。

`ojAgent.auth.login` 选定平台后默认走**浏览器自动登录**:
1. 启动 progress notification(顶部进度条) `'正在启动浏览器,请在弹出的浏览器内登录...'`,带"取消"按钮
2. 通过依赖注入的 `PlaywrightBrowserLogin` 启动 headed 浏览器,加载 `platformLoginConfigs[platform].loginUrl`
3. 用户在浏览器内完成登录(账号密码 / 微信扫码 / 第三方都可)
4. 检测到登录信号后扩展抓 cookie + username,关闭浏览器,写入 `SecretCredentialStore`
5. `CredentialChecker.check` 校验通过后展示 Notification `'✓ <platform> 登录成功(用户名: foo)'`,状态栏即时更新

降级路径:
- 浏览器找不到 / playwright-core 未装 / 平台不在 `platformLoginConfigs` 中 → 弹 Notification `'未检测到可用浏览器,改为手动粘贴 Cookie'`,然后:
  - LeetCode CN:走 `vscode.window.showInputBox` 两步(SESSION 隐藏、csrftoken 明文),与 M1 行为一致
  - HDOJ:走 M1 的 Webview 登录流程
- 用户点"取消"按钮 → 关闭浏览器,Notification `'已取消'`,不写入

新增命令:
- `ojAgent.auth.loginManual <platformId?>`:显式走粘贴流程,跳过浏览器
- `ojAgent.auth.cancelBrowserLogin`:进度条上的取消按钮回调

#### Scenario: 浏览器自动登录成功

- **WHEN** 用户执行 `ojAgent.auth.login` 选择 LeetCode CN,系统有 Chrome,30 秒内浏览器内完成登录
- **THEN** Webview 自动关闭,Notification 显示 `'✓ LeetCode CN 登录成功'`,状态栏图标从 ⚠ 切换到 ✓

#### Scenario: 浏览器找不到降级

- **WHEN** 系统无 Chromium 系浏览器
- **THEN** 扩展显示 Notification `'未检测到可用浏览器,改为手动粘贴 Cookie'`,自动弹出 `showInputBox`

#### Scenario: 用户取消

- **WHEN** 浏览器已启动,用户点击进度条上的"取消"
- **THEN** 浏览器进程关闭,Notification `'已取消'`,凭证仓库不变

#### Scenario: HDOJ 仍可用 Webview(若 LoginConfig 未实现)

- **WHEN** 用户执行 `ojAgent.auth.login` 选 HDOJ,且 platformLoginConfigs 中 HDOJ 实现尚未启用
- **THEN** 直接走 M1 的 Webview 登录路径,不影响现有体验

### Requirement: 登录态变更同步

`CredentialStore.onChange` 触发时,状态栏 SHALL 在 500ms 内更新 tooltip(各平台登录状态)与 TreeView 平台节点的 iconPath。**当浏览器自动登录写入凭证后,该 onChange 同样会触发**,UI 状态保持一致。

#### Scenario: 自动登录后状态栏即时更新

- **WHEN** 浏览器自动登录成功,扩展调用 `credentialStore.set('leetcode-cn', ...)`
- **THEN** 500ms 内状态栏图标 / TreeView 节点图标都已更新,且不需要用户手动刷新

## ADDED Requirements

### Requirement: 登出操作必须显式确认

`ojAgent.auth.logout` 命令在 `credentialStore.delete` 之前 MUST 弹出模态确认对话框(`vscode.window.showWarningMessage(..., { modal: true }, '登出')`),用户不点"登出"按钮则取消。这是为了防止从状态栏 QuickPick / 命令面板误触导致登录态丢失。

`ojAgent.auth.relogin` 命令 MUST NOT 经过该确认(意图明确,直接 delete + login)。

#### Scenario: 误触取消

- **WHEN** 用户从 QuickPick 选了"登出平台",modal 弹出后按 Esc 或点空白
- **THEN** `credentialStore` 不被修改,凭证保留

#### Scenario: 确认登出

- **WHEN** modal 弹出后用户点击"登出"按钮
- **THEN** `credentialStore.delete(platform)` 执行,Notification `'<platform> 已登出'`

#### Scenario: 显示用户名辅助识别

- **WHEN** modal 提示文本包含当前登录的用户名(若 `cred.extra.username` 存在)
- **THEN** 形如 `确认登出 leetcode-cn (wh131462)?`,帮助用户确认正在登出哪个账号

#### Scenario: relogin 跳过 modal

- **WHEN** 调用 `ojAgent.auth.relogin`
- **THEN** 直接 delete + login,不弹确认 modal

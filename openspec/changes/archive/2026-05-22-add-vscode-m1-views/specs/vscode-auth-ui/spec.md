## ADDED Requirements

### Requirement: 登录命令分发

扩展 SHALL 注册命令 `ojAgent.auth.login`、`ojAgent.auth.logout`、`ojAgent.auth.relogin`,均可接 `platformId?: PlatformId` 参数;不传时弹 QuickPick 让用户选平台(候选取自 `ojAgent.platforms.enabled`)。

#### Scenario: 不传平台时弹 QuickPick
- **WHEN** 执行 `ojAgent.auth.login` 不带参数
- **THEN** 弹 QuickPick 显示 `LeetCode CN` 与 `HDOJ`,用户选定后进入对应登录流程

### Requirement: HDOJ Webview 登录流程

`ojAgent.auth.login` 选择 `hdoj` 时,扩展 SHALL 创建 `WebviewPanel` viewType `ojAgent.hdojLogin`,加载 `http://acm.hdu.edu.cn/userloginex.php`。Webview MUST 注入一段 IIFE:监听全局表单提交事件,提交后 200ms 内读 `document.cookie`(`PHPSESSID`)并通过 `acquireVsCodeApi().postMessage({ type: 'cookie', value: ... })` 回传。

扩展收到后 MUST:
1. 通过 `HttpClient` 访问 `/` 携带该 cookie,验证响应包含登录后用户名
2. 校验通过 → `credentialStore.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=...', extra: { username } })`,关闭 webview,弹 Notification `'✓ HDOJ 登录成功'`
3. 校验失败 → webview 不关闭,弹 Notification `'登录态验证失败,请重试'`

如果 Webview 在 60 秒内没收到 cookie,扩展 MUST 在 panel 顶部展示"无法自动读取 cookie? 改用账号密码登录"提示,降级到 QuickInput 收集用户名 + 密码 → 通过 `HttpClient` form POST 完成登录(与 CLI 同款路径,共用 helper)。

#### Scenario: 自动捕获 cookie
- **WHEN** 用户在 webview 内提交登录表单且 HDOJ 设置 PHPSESSID
- **THEN** 扩展接收 cookie,校验后写入凭证仓库,webview 关闭

#### Scenario: 自动捕获失败降级
- **WHEN** 60 秒内无 cookie 回传
- **THEN** 提示并切到 QuickInput 收账号密码,form POST 登录

### Requirement: LeetCode CN 粘贴 Cookie 登录

`ojAgent.auth.login` 选择 `leetcode-cn` 时,扩展 SHALL:
1. `vscode.window.showInputBox({ prompt: 'LEETCODE_SESSION', password: true })` 收 SESSION
2. 第二步 `showInputBox({ prompt: 'csrftoken' })` 收 csrftoken
3. 调用 `CredentialChecker.check('leetcode-cn')` 验证;`'valid'` 写入,`'expired'` / `'unknown'` 拒绝并提示

同时提供命令 `ojAgent.auth.openCookieGuide` 触发 `vscode.env.openExternal` 打开扩展 README 的"如何获取 LeetCode Cookie"锚点(README 已存在时使用 `https://github.com/<owner>/<repo>#readme` 或本地 file URI;前置不强求)。

#### Scenario: 两步粘贴
- **WHEN** 用户依次输入合法 SESSION 与 csrftoken
- **THEN** 通过 `CredentialChecker` 校验,写入仓库,弹 Notification `'✓ LeetCode CN 登录成功(用户名: ...)'`

#### Scenario: SESSION 隐藏
- **WHEN** showInputBox 展示 SESSION 输入框
- **THEN** 输入框 password mask 启用(用户键入显示 `•`)

### Requirement: 登出与重新登录

`ojAgent.auth.logout` SHALL 直接调用 `credentialStore.delete(platform)`,弹 Notification 确认。MUST 幂等(凭证不存在时也返回 OK)。

`ojAgent.auth.relogin` SHALL 先调 logout,然后跳到 login。

#### Scenario: 登出幂等
- **WHEN** 未登录状态下执行 `ojAgent.auth.logout` 选 HDOJ
- **THEN** 不报错,弹 Notification `'HDOJ 已注销'`

### Requirement: 凭证存储位置

VSCode 端凭证 MUST 仅写入 `vscode.SecretStorage`,MUST NOT 写入 `workspace.getConfiguration` / 工作区文件 / 任何明文位置。键名沿用 core 规范 `oj.cookie.<platform>`,与 AI 的 `ai.apiKey.*` 隔离。

#### Scenario: 凭证不入配置
- **WHEN** grep `packages/vscode/src` 查找 `LEETCODE_SESSION` / `PHPSESSID` 字面量
- **THEN** 不出现在任何 `workspace.getConfiguration('ojAgent').update` 调用旁

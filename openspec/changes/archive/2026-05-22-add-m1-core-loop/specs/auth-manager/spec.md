## ADDED Requirements

### Requirement: 凭证存储隔离

系统 SHALL 将 OJ 平台凭证存入 VSCode `SecretStorage`，键名 MUST 形如 `oj.cookie.<platform>`，值 MUST 为 JSON 字符串 `{ cookies: Record<string,string>, csrfToken?:string, username?:string, updatedAt:string }`。OJ 凭证 MUST 与 AI 凭证（`ai.apiKey.*`）严格隔离，不可共用键空间。

#### Scenario: 写入 LeetCode CN 凭证

- **WHEN** 用户登录 LeetCode CN 成功
- **THEN** SecretStorage 键 `oj.cookie.leetcode-cn` 存在，且与 `ai.apiKey.*` 无任何键冲突

#### Scenario: 删除凭证

- **WHEN** 用户在状态栏菜单点击「登出 LeetCode CN」
- **THEN** SecretStorage 键 `oj.cookie.leetcode-cn` 被删除，状态栏显示「未登录」

### Requirement: Webview 登录（HDOJ）

系统 SHALL 通过 `vscode.window.createWebviewPanel` 加载 HDOJ 登录页 `userloginex.php`，启用 `enableScripts: true`，注入脚本在表单提交后通过 `document.cookie` 读取非 HttpOnly Cookie 并 `postMessage` 回宿主。宿主收到消息后 MUST 校验 `PHPSESSID` 存在再落盘。

#### Scenario: 登录后捕获 Cookie

- **WHEN** 用户在内嵌 webview 中提交 HDOJ 登录表单且成功
- **THEN** 宿主收到 `{ type:'cookie', cookie: 'PHPSESSID=...; ...' }`，写入 SecretStorage，Webview 自动关闭

### Requirement: 手动凭证录入（LeetCode CN）

系统 SHALL 提供 `OJ-Agent: 登录 LeetCode CN`命令，弹出 QuickInput 引导用户分别输入 `LEETCODE_SESSION` 与 `csrftoken`。输入后 MUST 调用 GraphQL `userStatus` 校验有效性，校验通过才落盘，否则提示并保留输入。

#### Scenario: 凭证校验失败

- **WHEN** 用户输入过期的 `LEETCODE_SESSION`
- **THEN** `userStatus` 返回 `isSignedIn: false`，命令提示「凭证无效，请重新登录后复制」，不写入 SecretStorage

### Requirement: 登录状态与失效检测

系统 SHALL 在扩展启动与每次发起需要登录的请求前检测凭证是否仍然有效。检测方式 MUST 为各平台轻量探活请求（LeetCode CN: `userStatus` GraphQL；HDOJ: 抓 `index.php` 检查 `<a href="userloginex.php?action=logout">`）。失效 MUST 在状态栏显示「⚠ <Platform> 登录已失效」并提供「重新登录」按钮。

#### Scenario: 启动时检测到失效

- **WHEN** 扩展启动时 LeetCode CN 凭证已过期
- **THEN** 状态栏立即显示「⚠ LeetCode CN 登录已失效」，且后续 `submit` 调用直接抛 `UNAUTHENTICATED`，不发请求

### Requirement: 多平台状态栏

系统 SHALL 在 VSCode 状态栏维护一个聚合项 `OJ-Agent`，点击后弹出 QuickPick 列出所有平台当前登录状态（`✓ 已登录(username)` / `✗ 未登录` / `⚠ 已失效`）与「登录」「登出」「重新登录」操作。

#### Scenario: 查看登录状态

- **WHEN** 用户点击状态栏 `OJ-Agent` 项
- **THEN** QuickPick 列出 LeetCode CN 与 HDOJ 各自状态与操作项

## Why

M1 落地后用真账号验证发现:CLI `oja login leetcode-cn` 当前方案要求用户从浏览器 DevTools 手动复制 `LEETCODE_SESSION` 与 `csrftoken` 粘贴回终端。这一步对非工程师用户极不友好,在实际使用第一次就被卡住。

主流 CLI(`gh auth login` / `npm login` / `vercel login`)的体验是:命令行触发 → 自动拉起系统浏览器 → 用户在浏览器内人工登录 → CLI 自动捕获凭证。OJ-Agent 应该做同样的事。

LeetCode CN 没有 OAuth Device Code 端点,我们必须自己启动一个真实浏览器实例,等用户在该实例内完成登录,然后从浏览器 context 中读取 cookie。`playwright-core`(不下载浏览器,复用系统 Chrome/Edge/Brave)是体积最小、跨平台最稳的方案。

后续 M2 接 Codeforces / 洛谷(都没 OAuth,且有 Cloudflare / 易盾验证) 时,这套自动登录能力**必须复用**,所以现在就把它做成可复用的能力比 M2 时回头补成本低。

## What Changes

- **新增** `@oj-agent/core` 内 `auth/browser-login.ts`:`BrowserLoginCapture` 接口,由前端注入实现;封装"启动浏览器 → 等待登录完成的信号 → 抽 cookie"的统一编排逻辑。
- **新增** `@oj-agent/core` 内 `auth/login-flow.ts`:`LoginFlow.run({ platform, capture, credentialStore })` 编排:调用 `capture` 拿原始 cookie 与 username → 调用 `CredentialChecker.check` 校验有效 → 写入 `CredentialStore`;失败流程统一抛 `AdapterError`。
- **新增** `@oj-agent/core` 内各平台的 `LoginConfig`:LeetCode CN 与 HDOJ 各自的"登录页 URL / 已登录标识 / 用户名抽取方式"配置,作为 `BrowserLoginCapture` 的入参。
- **新增** `packages/cli` 内 `backends/playwright-browser-login.ts`:`PlaywrightBrowserLogin implements BrowserLoginCapture`,基于 `playwright-core`,自动检测系统 Chrome/Edge/Brave/Chromium 任一可用,启动 headed 浏览器、加载登录页、监听导航完成、读 cookie。
- **新增** `packages/vscode` 内同样的 `PlaywrightBrowserLogin`(共享 npm 依赖,各自 import)。
- **修改** CLI `oja login <platform>`:默认调用自动流程;新增 `--manual` flag 显式走原粘贴流程;浏览器启动失败(系统 Chrome 找不到等)自动 fallback 到粘贴流程,带提示信息。
- **修改** VSCode `ojAgent.auth.login`:类似默认自动 + 失败降级。
- **新增** 运行时依赖:`packages/cli` 与 `packages/vscode` 各自加 `playwright-core`(可选/optional,缺失走粘贴 fallback)。
- **不变** core 任何已有 spec 的 Requirement(`auth-manager-core` / `cli-commands` 等通过 ADDED 扩展;不修改既有规则)。

## Capabilities

### New Capabilities

- `browser-auto-login`: 浏览器自动登录的统一接口契约、平台 LoginConfig、登录态检测协议、降级策略。

### Modified Capabilities

- `cli-commands`: `oja login` 默认行为变更为自动浏览器登录;`--manual` flag 与降级路径 ADDED。
- `vscode-auth-ui`: HDOJ Webview 登录可被自动浏览器流程替代;LeetCode CN 不再以 QuickInput 为默认入口;新增 `ojAgent.auth.loginManual` 命令;`logout` 命令新增模态确认对话框防止误触。
- `vscode-status-bar`: QuickPick 选项重排,登出 / 重新登录与登录入口之间用 Separator 分隔,登出移到底部以降低误触概率。

## Impact

- **代码**:`packages/core/src/auth/` 新增 `browser-login.ts`、`login-flow.ts`、`platform-login-configs.ts`;`packages/cli/src/backends/` 新增 `playwright-browser-login.ts`;`packages/vscode/src/extension/backends/` 同样新增;两端 `commands/login.ts`/`commands/auth.ts` 重写。
- **依赖**:CLI 与 VSCode 各自 `optionalDependencies` 加 `playwright-core`(~10MB,不下载 Chromium 二进制);用户机器需安装 Chrome/Edge/Brave/Chromium 任一(覆盖 95%+ 用户)。
- **测试**:core 新增 `LoginFlow` 单测(mock capture);前端用 mock playwright 测启动+ cookie 抽取;真实浏览器流程留给手工 QA。
- **文档**:CLI / VSCode README 增加"浏览器自动登录"章节;`oja login --help` 提示降级方法。
- **下游 change**:M2 Codeforces / 洛谷适配器接入时直接复用 `LoginFlow`,只需新增 `LoginConfig`。

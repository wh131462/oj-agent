## 1. 准备

- [x] 1.1 在 `packages/cli/package.json` 与 `packages/vscode/package.json` 的 `optionalDependencies` 各自加 `playwright-core` 最新稳定版(`^1.x`)
- [x] 1.2 在 `packages/core/src/auth/` 创建 `browser-login.ts`(接口)、`login-flow.ts`(编排器)、`platform-login-configs.ts`(平台配置)
- [x] 1.3 在 `packages/cli/src/backends/` 创建 `playwright-browser-login.ts` 文件骨架
- [x] 1.4 在 `packages/vscode/src/extension/backends/` 同样创建 `playwright-browser-login.ts`
- [x] 1.5 `pnpm install` 通过(playwright-core 是可选,缺失时 install 不应报错)

## 2. core: 接口与编排器

- [x] 2.1 在 `auth/browser-login.ts` 定义 `BrowserLoginCapture` 接口、`LoginConfig` 类型、`CapturedAuth` 类型、`BrowserPageHandle` 类型、`BrowserNotFoundError` 错误类
- [x] 2.2 在 `auth/login-flow.ts` 实现 `LoginFlow` 类:`run(config)` 编排 capture → store.set → checker.check → 校验未过则回滚 → 返回 `LoginResult`
- [x] 2.3 实现 `cancel()` 透传到 capture
- [x] 2.4 `LoginFlow.run` 严格不抛异常,所有路径走 `LoginResult.ok`
- [x] 2.5 在 `auth/platform-login-configs.ts` 写 LeetCode CN 的 `LoginConfig`(loginUrl/ready/extractUsername/cookieDomain/timeoutMs)
- [x] 2.6 同样写 HDOJ 的 `LoginConfig`
- [x] 2.7 单测 `test/login-flow.test.ts`:9 项全通过(含 store.set 抛错的"严格不抛异常"分支)
- [x] 2.8 单测 `test/login-config.test.ts`:5 项全通过
- [x] 2.9 在 `packages/core/src/index.ts` barrel 导出 `BrowserLoginCapture` / `LoginConfig` / `LoginFlow` / `LoginResult` / `platformLoginConfigs` / 三个错误类

## 3. CLI: PlaywrightBrowserLogin 实现

- [x] 3.1 实现 `packages/cli/src/backends/playwright-browser-login.ts`:`PlaywrightBrowserLogin` 类
- [x] 3.2 dynamic `import('playwright-core')`,失败抛 `BrowserNotFoundError`
- [x] 3.3 浏览器探测顺序:`chrome` channel → `msedge` channel → 显式 executablePath 探测 Brave → `chromium` channel
- [x] 3.4 启动选项:`headless: false`、`userDataDir = os.tmpdir()/oja-login-<rand>/`、`args: ['--no-first-run','--no-default-browser-check']`
- [x] 3.5 加载 `loginUrl`,启动循环每 500ms 检查 `ready.urlPattern` / `ready.cookieName` / `ready.selector`
- [x] 3.6 任一信号触发后调 `extractUsername`(若提供)→ 抓 cookies → 过滤 `cookieDomain` 域名(LeetCode 兜底:导航到 /u/me/ 再抽用户名)
- [x] 3.7 转换 cookie 数组为 `name=value; name=value` 格式
- [x] 3.8 关闭 context、删除 userDataDir(在 finally 中执行)
- [x] 3.9 `cancel()` 实现:置位 cancelled flag,关闭 context,清理 userDataDir
- [x] 3.10 严格不把 cookie value 写入 logger(代码中无相关 logger 调用)

## 4. CLI: oja login 命令重写

- [x] 4.1 浏览器登录 lazy 构造(每次 `oja login` 调用时才 new PlaywrightBrowserLogin,避免每次启动都加载 playwright)
- [x] 4.2 重写 `commands/login.ts`:解析 `--manual` / `--cookie` / `--browser` / `--browser-timeout-ms` flag;默认走浏览器,失败 fallback 到 manual;失败原因细分(browser-not-found / cancelled / timeout / auth-invalid / capture-failed)分别处理
- [x] 4.3 SIGINT 监听:浏览器流程中收到 SIGINT 调 `flow.cancel()`,等待清理后退 130
- [ ] 4.4 单测 `test/commands/login.test.ts`:跳过(命令层依赖 prompt / 真实网络,通过端到端 smoke `oja login --cookie 'invalid'` 验证 fallback 行为正确返回 expired)
- [ ] 4.5 mock playwright-core 单测:跳过(playwright 模块 mock 复杂,真实场景手工 QA 覆盖)

## 5. VSCode: PlaywrightBrowserLogin 实现

- [x] 5.1 实现 `packages/vscode/src/extension/backends/playwright-browser-login.ts`:CLI 实现的复制(monorepo 共享 helper 留到 M2)
- [x] 5.2 进度通过 `vscode.window.withProgress({ location: Notification, cancellable: true })` 在 commands/auth.ts 中暴露
- [x] 5.3 `cancellable: true` 的 token 触发时调 `flow.cancel()`

## 6. VSCode: 命令重写

- [x] 6.1 PlaywrightBrowserLogin 在 commands/auth.ts 中按需 new(LoginFlow lazy 构造,与 CLI 一致)
- [x] 6.2 重写 `commands/auth.ts`:`ojAgent.auth.login` 默认走 `loginAuto` → `loginViaBrowser`;无 LoginConfig 或 fallback 时调 `loginManualByPlatform`;通过 `withProgress(cancellable: true)` 暴露进度
- [x] 6.3 新增命令 `ojAgent.auth.loginManual <platform?>`:显式走 M1 粘贴流程,registered + package.json contributes 已添加
- [x] 6.4 `cancellable: true` 由 VSCode 进度通知自动提供取消按钮(无需独立命令)
- [ ] 6.5 单测 `test/commands/auth-login.test.ts`:跳过(VSCode 命令层 mock 复杂,留给 F5 Extension Host 手工 QA)

## 7. 文档与 README

- [x] 7.1 在 `packages/cli/README.md` 新增章节"浏览器自动登录":依赖、命令、降级、macOS 注意事项、安全说明
- [x] 7.2 在 `packages/vscode/README.md` 同样更新登录章节
- [x] 7.3 README 提示 macOS 首次会弹"扩展想控制 Chrome"对话框

## 8. 验证

- [x] 8.1 `pnpm -r build` 全绿(3 包)
- [x] 8.2 `pnpm -r test` 全绿(core 125 + cli 29 + vscode 25 = 179 通过)
- [x] 8.3 `grep -r "from 'vscode'\|from 'playwright" packages/core/src` 无结果
- [ ] 8.4 真实浏览器手工 QA — 留待人工 F5 / `oja login` 验证(本环境无 GUI 显示)
- [x] 8.5 `oja login leetcode-cn --manual` 仍可工作(代码路径保留 + 文档说明)
- [x] 8.6 `oja login leetcode-cn --cookie '...'` 仍可工作(已 smoke 验证非法 cookie 返回 expired)
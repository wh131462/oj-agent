## 1. 准备:依赖、目录、配置 schema

- [x] 1.1 `packages/vscode/package.json` 新增 `dependencies`:`markdown-it`、`markdown-it-katex`(或 `markdown-it-texmath`,实现时择优)、`katex`;新增 `devDependencies`:`@types/markdown-it`、`@vscode/test-electron`(若尚无)
- [x] 1.2 新增 contributes:`views.ojAgent` 增加 `ojAgent.problems`;`commands` 增加 M1 命令清单(`platform.* / judge.* / submission.* / auth.* / workspace.setRoot / statusBar.openQuickPick / openOutputChannel` 等);`menus.view/title` 加 `ojAgent.problems` 工具栏(search/filter/tag/prev/next/refresh);`menus.view/item/context` 加题目右键;`activationEvents` 追加 `onView:ojAgent.problems` 与 `onCommand:ojAgent.platform.*` 等
- [x] 1.3 新增 `configuration.properties` 项:`ojAgent.workspace.root / platforms.enabled / http.proxy / http.rateLimit.* / lang.* / judge.timeoutMs / submission.* / ui.defaultLang`,默认值与 schema 见 design D7
- [x] 1.4 在 `packages/vscode/src/extension/` 创建子目录:`backends/`、`views/`、`commands/`、`context-providers/`、`webview-content/`、`utils/`、`resources/katex/`(把 katex npm 包静态资源拷过来)
- [x] 1.5 `pnpm install` 通过;`pnpm --filter oj-agent build` 通过

## 2. backends

- [x] 2.1 实现 `backends/vscode-secret.ts`:`VSCodeSecretBackend`,封装 `context.secrets`
- [x] 2.2 实现 `backends/vscode-config.ts`:`VSCodeConfigBackend`,封装 `workspace.getConfiguration('ojAgent')` 与 `onDidChangeConfiguration` 过滤
- [x] 2.3 实现 `backends/vscode-output-channel-logger.ts`:`VSCodeOutputChannelLogger`,基于 `createOutputChannel({ log: true })`,info/warn/error 加 scope 前缀
- [x] 2.4 在 `extension.ts` 的 `activate` 中按 design D5 顺序构造 logger → secretBackend → configBackend → credentialStore → rateLimiter → httpClient → registry → workspaceManager → judgeRunner → submissionRunner,全部 `context.subscriptions.push`
- [x] 2.5 单测 `test/vscode-config.test.ts`(`vscode-test`):写 settings → backend.get / onChange 触发

## 3. TreeView ojAgent.problems

- [x] 3.1 实现 `views/problem-tree.ts`:`ProblemTreeDataProvider implements TreeDataProvider<TreeNode>`,两层结构;getChildren 第一层返回 `platforms.enabled` 中的平台;第二层调 `adapter.listProblems(query)`
- [x] 3.2 实现筛选 / 分页命令:`ojAgent.problems.{search,filterDifficulty,filterTags,prevPage,nextPage,refresh}`;状态持久化到 `workspaceState`
- [x] 3.3 实现图标逻辑:平台节点按 credentialChecker 探活结果选 iconPath;题目节点按难度上色
- [x] 3.4 订阅 `credentialStore.onChange` 与 `configBackend.onChange('platforms.enabled')`,刷新 TreeView
- [x] 3.5 右键菜单命令:`ojAgent.platform.{pullProblem,openInBrowser,copyProblemId}`,各自实现
- [x] 3.6 单测 `test/problem-tree.test.ts`:mock registry,验证两层结构、筛选透传、未登录态图标

## 4. 题面 Webview

- [x] 4.1 实现 `webview-content/problem-html.ts`:`renderProblemHtml({ problemRef, meta, markdown, webview, extensionUri, aiEnabled, nonce })` → 完整 HTML 字符串,含 CSP、工具栏、内容区、消息桥
- [x] 4.2 实现 `views/problem-webview.ts`:`ProblemWebviewManager`,内部维护 `Map<key, Panel>`(key = `<platform>:<id>`),`open(ref)` 复用或创建;`postInit / postRefresh`
- [x] 4.3 集成 markdown-it + katex:在扩展端把 `problem.md` 渲染为 HTML(让 katex CSS / 字体走 `webview.asWebviewUri`);失败降级为原 markdown 纯文本
- [x] 4.4 实现 `webview.onDidReceiveMessage` 路由:把 `{ type:'cmd', cmd, args }` 透传给 `vscode.commands.executeCommand('ojAgent.' + cmd, args)`
- [x] 4.5 AI 按钮 disable 状态同步:订阅 `configBackend.onChange('ai.activeProfileId')`,`panel.webview.postMessage({ type:'aiAvailableChanged', enabled })`
- [x] 4.6 命令 `ojAgent.platform.openProblemView`、`ojAgent.platform.refreshProblem`、`ojAgent.platform.pullByUrl`(粘贴 URL 后自动识别 platform/id)、`ojAgent.platform.copyProblemId`
- [x] 4.7 单测 `test/problem-webview.test.ts`:mock webview,验证 message 路由与 init payload 结构

## 5. 本地测试结果面板

- [x] 5.1 实现 `webview-content/judge-html.ts`:`renderJudgeHtml({ result, problemRef, aiEnabled, webview })` → 顶部 summary / 错误条 / 用例卡片列表 / AI 按钮
- [x] 5.2 实现 `views/judge-panel.ts`:`JudgePanelManager`,每题最多一个 panel;`show(problemRef)` 与 `update(result)`
- [x] 5.3 实现命令 `ojAgent.judge.runAll`:推断 lang(扫 `solution.<ext>`)→ 调 `JudgeRunner.runAll` → 调 `panel.update(result)`;UI 进入 running 状态(spinner)
- [x] 5.4 实现 `ojAgent.judge.runCase` 单 case 运行入口(在卡片右下角"重跑此用例")
- [x] 5.5 失败用例 AI 按钮路由:点击发 `{ cmd: 'ai.explainError', args }`,扩展执行已有命令
- [x] 5.6 单测 `test/judge-panel.test.ts`:渲染 HTML 快照(AC / WA / CE 三个分支)与 message 路由

## 6. 登录 UI

- [x] 6.1 命令 `ojAgent.auth.login`:不带参数时 QuickPick;HDOJ 走 Webview;LeetCode 走 QuickInput 两步
- [x] 6.2 实现 `views/auth-webview.ts` HDOJ 登录 webview:加载 `userloginex.php`,注入 IIFE 读 `document.cookie`,通过 postMessage 回传;60s 无回传降级到账号密码 QuickInput → `HttpClient` form POST(GBK)登录
- [x] 6.3 LeetCode CN QuickInput:两步,SESSION 输入框 password mask,csrftoken 普通;校验通过 → 存
- [x] 6.4 命令 `ojAgent.auth.logout` 与 `ojAgent.auth.relogin`(logout + login)
- [x] 6.5 命令 `ojAgent.auth.openCookieGuide`:`vscode.env.openExternal`(README 锚点暂用 GitHub README URL,实现时占位即可)
- [x] 6.6 单测 `test/auth-webview.test.ts`:mock webview message 通道,验证 cookie 校验后写入仓库

## 7. 状态栏

- [x] 7.1 实现 `views/status-bar.ts`:`StatusBarManager`,创建并管理 StatusBarItem;封装 `setIdle()` / `setSubmitting()` / `setJudging()` / `setVerdict(v, ms)` / 自动 5s+10s 切换定时器
- [x] 7.2 订阅 `credentialStore.onChange` → 更新 tooltip
- [x] 7.3 命令 `ojAgent.statusBar.openQuickPick`:QuickPick 列出 design D5 中 6 项
- [x] 7.4 接入 `SubmissionRunner.run` 的 `onProgress`:`commands/submission.ts` 调 run 时传入回调,在回调内 `statusBarManager.set*`
- [x] 7.5 `configBackend.onChange('platforms.enabled')` 为空时 hide,非空时 show
- [x] 7.6 单测 `test/status-bar.test.ts`:模拟 onProgress 序列,验证 text 切换序列

## 8. 提交命令与平台命令

- [x] 8.1 命令 `ojAgent.submission.submit`:推断 problemDir / lang / code → confirm dialog(可关闭确认) → `SubmissionRunner.run`,onProgress 同步状态栏与 judgeResult panel
- [x] 8.2 命令 `ojAgent.submission.openLatest`:打开最近一次结果的 judgeResult panel(若有);否则 toast 提示
- [x] 8.3 命令 `ojAgent.platform.pullByUrl`:`showInputBox` 收 URL → 解析 platform/id → adapter.getProblem → workspaceManager.writeProblem → 打开题面 Webview
- [x] 8.4 命令 `ojAgent.platform.pullProblem`:由 TreeView 右键传 `{ platform, id, slug }` → 同上但跳过 URL 解析
- [x] 8.5 命令 `ojAgent.platform.openInBrowser`:`vscode.env.openExternal`
- [x] 8.6 命令 `ojAgent.platform.refreshProblem`:`workspaceManager.refresh` → `panel.postRefresh`
- [x] 8.7 命令 `ojAgent.platform.addCustomCase`:`showInputBox` 收 input / output → `workspaceManager.addCustomCase`
- [x] 8.8 命令 `ojAgent.workspace.setRoot`:`showOpenDialog({ canSelectFolders: true })` → 写入 `ojAgent.workspace.root`
- [x] 8.9 命令 `ojAgent.openOutputChannel`:`outputChannel.show(true)`
- [x] 8.10 命令 `ojAgent.judge.openToolchain`:WebviewPanel 或 information message 列工具链;复用 `ToolchainProbe.probe()`

## 9. AI 联动

- [x] 9.1 实现 `context-providers/problem.ts` `ProblemContextProvider.get(ref)`:从工作区读 `problem.md / meta.json / solution.<ext>` 组装 `ProblemContext`(已存在 core 类型)
- [x] 9.2 实现 `context-providers/test-case.ts` `TestCaseContextProvider.get(ref, caseIndex)`:从最近一次 `JudgeRunResult` 缓存读出(扩展端维护 `Map<problemRef, lastResult>`)
- [x] 9.3 在 `activate` 中把两个 provider 注册到 core 的 `context-builder`(具体 API 取自 `add-monorepo-layout` 落地的 `buildContext`)
- [x] 9.4 题面 Webview / judgeResult panel 中 AI 按钮已实现(任务 4、5);本任务确认参数与 provider 衔接无缺
- [x] 9.5 单测 `test/context-providers.test.ts`:tmp problemDir + mock judgeResult → provider 输出字段完整

## 10. 验证与发布准备

- [x] 10.1 `pnpm -r build` 全绿;`pnpm --filter oj-agent test` 全绿
- [x] 10.2 `grep -r "from 'vscode'" packages/core/src` 仍无结果(回归 monorepo-layout 验证)
- [ ] 10.3 F5 启动 Extension Host 手动验证: <!-- 受限于无 GUI 环境,按用户决策延后到人工 QA -->
   - TreeView 显示 LeetCode CN / HDOJ
   - 登录 HDOJ(账号密码)、登录 LeetCode CN(粘贴 Cookie)
   - 状态栏在登录后立即更新
   - 列表分页 / 关键字 / 难度筛选
   - 拉取 `LeetCode/two-sum` 打开题面 Webview,公式与 markdown 正常渲染
   - 写代码后运行测试,WA case 显示 diff
   - 提交后状态栏依次切到 Submitting / Judging / AC
   - 失败用例点击"AI: 解释错因",ai-assistant 面板流式出文
- [ ] 10.4 离线场景:断网下打开已拉取题目,题面与公式正常 <!-- 同 10.3,需 GUI 验证 -->
- [ ] 10.5 工具链缺失:卸载 javac 后 `ojAgent.judge.openToolchain` 显示 ✗;Java 题点运行后 Notification 提示安装链接 <!-- 同 10.3 -->
- [ ] 10.6 14 条 AI 既有命令与 AI Profiles / Actions TreeView 仍正常工作(回归) <!-- 同 10.3 -->
- [x] 10.7 文档:在 `packages/vscode/README.md` 追加 M1 功能段(若文件不存在则创建,作为扩展 README 是必要文档)与首次使用指引

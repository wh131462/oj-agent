## Why

VSCode 当前只挂了 AI 助手相关的 14 条 contributes.commands(在 `packages/vscode/package.json`),没有任何 OJ 平台交互的 UI。M1 闭环必须在 VSCode 端落地:**题库 TreeView、题面 Webview、本地测试结果面板、提交流程、登录 Webview、状态栏聚合**。这一层是 PRD §1.2 中 VSCode 形态的最终用户入口,也是把 `add-platform-foundations / add-judge-and-workspace` 的 core 能力呈现给"在 IDE 内刷题"用户的最后一公里。

## What Changes

- **新增** `OJ-Agent: 题库` TreeView(`ojAgent.problems`):第一层为平台,第二层为题目;支持搜索 / 难度 / 标签筛选,分页与 loading 占位。
- **新增** 题面 Webview(`ojAgent.problemView`):`markdown-it + markdown-it-katex` 渲染 `problem.md`;工具栏 4 个 OJ 按钮(运行 / 提交 / 刷新 / 打开代码) + 4 个 AI 入口(对接 `ai-assistant` 既有命令)。
- **新增** 本地测试结果面板(`ojAgent.judgeResult`):每个 case 显示 verdict / 耗时 / input / expected / actual / unified diff;失败用例右侧挂"解释错因"按钮(参数附 `caseIndex`)。
- **新增** 登录 Webview:HDOJ 加载 `userloginex.php`,用户提交表单后扩展通过 `webview.postMessage` 接收 `document.cookie`(HDOJ 非 HttpOnly);LeetCode CN 提供命令"粘贴 Cookie",QuickInput 分两步收 `LEETCODE_SESSION` 与 `csrftoken`,校验后存入 `SecretStorage`。
- **新增** `VSCodeSecretBackend implements SecretBackend`(基于 `context.secrets`)与 `VSCodeConfigBackend implements ConfigBackend`(基于 `workspace.getConfiguration('ojAgent')`)、`VSCodeOutputChannelLogger implements LoggerBackend`(基于一个新建 OutputChannel `OJ-Agent`)。
- **新增** 状态栏聚合项 `OJ-Agent`:展示 ⓘ/⚠/⏳ 与当前活动平台登录状态、提交进度;点击弹 QuickPick(登录 / 登出 / 重新登录 / 切换工作区根目录 / 打开 OutputChannel)。
- **新增** 命令清单:
  - `ojAgent.platform.pullByUrl`(粘贴 URL 拉题)
  - `ojAgent.platform.pullProblem`(从 TreeView 右键)
  - `ojAgent.platform.openInBrowser`
  - `ojAgent.platform.refreshProblem`
  - `ojAgent.platform.addCustomCase`
  - `ojAgent.judge.runAll`(对当前 problemDir)
  - `ojAgent.judge.runCase`(单个用例)
  - `ojAgent.submission.submit`
  - `ojAgent.submission.openLatest`
  - `ojAgent.auth.login`、`ojAgent.auth.logout`、`ojAgent.auth.relogin`(均接平台参数)
  - `ojAgent.workspace.setRoot`
- **新增** 配置项:`ojAgent.workspace.root`、`ojAgent.http.proxy`、`ojAgent.http.rateLimit.<platform>`、`ojAgent.lang.<lang>.compile/run`、`ojAgent.judge.timeoutMs`、`ojAgent.submission.minIntervalMs`、`ojAgent.submission.pollTimeoutMs`、`ojAgent.ui.defaultLang`、`ojAgent.platforms.enabled`(数组,M1 默认 `['leetcode-cn','hdoj']`)。
- **新增** 依赖:`markdown-it`、`markdown-it-katex`、`katex`(用于 Webview 渲染)。Webview 内的 KaTeX CSS 与 JS 走 `webview.asWebviewUri` 的本地 resources。
- **新增** AI 联动:`ProblemContextProvider` 与 `TestCaseContextProvider`,把当前题目 / 失败用例打包后调用 `ai-assistant` 既有命令;未配置 AI Profile 时按 `ai-assistant` 既有规范禁用按钮。
- **不变** 现有 14 条 AI commands、AI Profiles TreeView、AI Actions TreeView、AI 设置 Webview 与 ai-assistant 业务逻辑。

## Capabilities

### New Capabilities

- `vscode-problem-tree`: 题库 TreeView 的视图、筛选、分页、上下文菜单契约。
- `vscode-problem-webview`: 题面 Webview 渲染、工具栏命令、消息协议规范。
- `vscode-judge-panel`: 本地测试结果面板 Webview 的展示与 AI 入口集成规范。
- `vscode-auth-ui`: VSCode 端两平台登录 UI 流程与凭证落盘规范。
- `vscode-status-bar`: 状态栏聚合项与 QuickPick 入口规范。
- `vscode-backends`: VSCode 端三大 backend(Secret/Config/Logger)实现契约。

### Modified Capabilities

- `ai-assistant`: 新增"上下文来源 · OJ 平台联动"段落:声明题面 Webview / 测试结果面板为 AI 入口的承载位置,并由本变更提供 `ProblemContext / TestCaseContext` 数据结构给 `context-builder` 使用。原有 Requirement 不变。

## Impact

- **代码**:`packages/vscode/src/extension/` 下新增 `views/{problem-tree.ts,problem-webview.ts,judge-panel.ts,auth-webview.ts,status-bar.ts}`、`backends/{vscode-secret.ts,vscode-config.ts,vscode-output-channel-logger.ts}`、`commands/{platform,judge,submission,auth,workspace}.ts`、`context-providers/{problem.ts,test-case.ts}`、`resources/{katex/*,markdown-it.css}` 静态资源。
- **配置**:`packages/vscode/package.json` 新增 ~12 条命令、1 个 view、若干 menu、配置项;不删除已有项。
- **依赖**:`markdown-it`、`markdown-it-katex`、`katex` 进 `dependencies`;`@types/markdown-it` 进 dev。
- **激活事件**:补 `onCommand:ojAgent.platform.*`、`onView:ojAgent.problems`;`onStartupFinished` 保留。
- **测试**:`packages/vscode/test/` 下新增 problem-tree / webview 消息路由 / status-bar / backends 单测;Webview 端到端冒烟以 markdown 渲染快照验证。
- **AI 联动**:不动 `ai-assistant` 已有命令实现,只在 webview / 面板挂按钮触发它们;新增的 `ProblemContextProvider` 与 `TestCaseContextProvider` 通过 core 的 `context-builder` 注册接口(已存在)接入。

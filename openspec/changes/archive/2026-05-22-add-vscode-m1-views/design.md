## Context

VSCode 端当前只有 AI 助手相关 UI(AI Profiles TreeView、AI Actions TreeView、AI 设置 Webview、AI 助手对话面板),没有任何 OJ 平台 UI。M1 闭环必须在编辑器内交付:**TreeView 浏览 / Webview 看题 / 一键测试 / 一键提交 / 状态栏 / 登录**。

`@oj-agent/core` 在 `add-platform-foundations` + `add-judge-and-workspace` 完成后,已提供:
- `PlatformAdapterRegistry` 用于拉题与提交
- `WorkspaceManager` 用于落盘
- `JudgeRunner` 用于本地测试
- `SubmissionRunner` 用于提交编排
- `CredentialStore` 凭证仓库,接受 `SecretBackend` 注入
- `LoggerBackend` 注入接口
- HDOJ 适配器在 core 内 `login()` 抛 AUTH_REQUIRED;前端负责具体 UI

约束:
- VSCode ≥ 1.94,ESM 扩展。
- 不允许直接 fetch;所有出网通过 `HttpClient`(已在 core)。
- AI 现有 14 条 commands 与三处 UI(Profiles TreeView / Actions TreeView / 对话面板) MUST 不动。
- 凭证仅存 `vscode.SecretStorage`,与 AI Key 命名空间隔离。
- 工作区目录命名遵循 core `WorkspaceManager`(`<root>/<platform>/<id>-<slug>-<date>/`)。
- Webview CSP 严格(`default-src 'none'; script-src ${nonce}; style-src ${nonce};`)。

干系人:在编辑器内刷题的开发者、参加竞赛的学生、用 LeetCode 求职的工程师。

## Goals / Non-Goals

**Goals:**
- 用户安装扩展后:点 Activity Bar `OJ-Agent` → 看见 TreeView 列出 LeetCode CN / HDOJ;登录后能展开看题、双击拉到工作区并打开题面 Webview;一键测试/提交;状态栏看进度;失败用例可触发 AI 解释错因。
- 与 AI 助手的现有四个入口无缝集成(题面工具栏 4 个按钮、测试结果面板失败用例旁的"解释错因"按钮)。
- 题面 Webview 支持 Markdown + KaTeX(完整离线渲染)。
- 配置项与 CLI 完全对齐(同 key 同语义,只是位置不同)。

**Non-Goals:**
- 不替换或重写 ai-assistant 任何已有实现。
- 不实现 Codeforces / 洛谷 / POJ / 蓝桥 UI(M2/M3)。
- 不实现"提交结果页 Webview 兜底"(M2 再加,参 add-m1-core-loop 已 archive 的 Open Question)。
- 不实现快捷键绑定(Open Question)。
- 不解决 `vsce package` 对 workspace:* 依赖打包问题(M3)。
- 不实现 watch 模式(保存自动测试)。

## Decisions

### D1:TreeView 视图布局

`Activity Bar > OJ-Agent`(已存在容器) SHALL 新增视图 `ojAgent.problems`,与已有 `ojAgent.aiProfiles / ojAgent.aiActions` 并列。

层级:
- 第一层:平台节点(`leetcode-cn` / `hdoj`),展示登录状态图标(已登录 `$(account)` / 未登录 `$(account-off)`)
- 第二层:题目节点,带难度图标(`$(symbol-event)` 绿/橙/红)与题号 + 标题
- 第三层:不展开;双击或右键 `拉取到本地` 触发 `ojAgent.platform.pullProblem`

筛选 / 分页 UI:视图工具栏(`view/title` menu)按钮:
- `$(search)` 搜索关键字(QuickInput)
- `$(filter)` 难度筛选(QuickPick)
- `$(tag)` 标签筛选(QuickPick,多选)
- `$(arrow-left) / $(arrow-right)` 上一页 / 下一页

筛选状态持久化到 `workspaceState.get('ojAgent.problems.<platform>.query')`。

### D2:题面 Webview

Webview viewType `ojAgent.problemView`,localResources 包含 `katex/`、`markdown-it.css`。

工具栏(Webview 内 HTML 按钮,通过 postMessage 路由到扩展):
- 运行 → `ojAgent.judge.runAll`
- 提交 → `ojAgent.submission.submit`
- 刷新 → `ojAgent.platform.refreshProblem`
- 打开代码 → `vscode.window.showTextDocument(solutionUri)`
- AI:解释错因 / 生成思路 / 生成题解 / 解释代码 → 4 个已有命令(`ojAgent.ai.*`),参数含 `{ platform, id, slug }`

未配置 AI Profile 时,按钮 className 含 `disabled`,点击不发消息,显示 tooltip(沿用 ai-assistant 既有规范)。

Markdown 渲染:`markdown-it({ html: true, linkify: true, breaks: false }).use(katex)`,渲染结果用 `webview.asWebviewUri` 替换图片地址(若题面引用了 LeetCode CN 的图床则保留绝对 URL,需在 CSP `img-src` 中加上 `https://`)。

CSP:`default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`

### D3:本地测试结果面板

Webview viewType `ojAgent.judgeResult`,与题面 Webview 不同 panel,可同时打开。

布局:
- 顶部 summary:`X / Y AC, total Zs`,带"重跑全部"按钮
- 用例列表:每项 `verdict 徽章 / index / time / 折叠 input / expected / actual / unifiedDiff`
- 失败用例右侧:`AI: 解释错因` 按钮,参数 `{ platform, id, caseIndex, input, expected, actual, diffSummary, language, sourceCode }`

数据来源:扩展执行 `JudgeRunner.runAll` 后通过 `panel.webview.postMessage({ type: 'result', payload })` 推送;Webview 不直接接触 fs。

### D4:登录 UI

**HDOJ**:`ojAgent.auth.login` 选 hdoj 时:
1. `vscode.window.createWebviewPanel('ojAgent.hdojLogin', 'HDOJ 登录', One)`,加载 `http://acm.hdu.edu.cn/userloginex.php`(allowScripts + 注入一段 IIFE 监听表单提交,提交后读 `document.cookie` 通过 `acquireVsCodeApi().postMessage({ cookie })`)
2. 扩展接收 `PHPSESSID=...`,通过 `HttpClient` 验证后 `credentialStore.set('hdoj', { cookie })`,关闭 webview。

(注:Webview 默认隔离自己的 cookie jar,故必须靠 `document.cookie` JS 读取;HDOJ 的 PHPSESSID 非 HttpOnly。)

**LeetCode CN**:`ojAgent.auth.login` 选 leetcode-cn 时,改用 QuickInput 分两步(粘贴 SESSION + csrftoken),与 CLI 一致(因为 HttpOnly 拿不到)。同时提供命令 `ojAgent.auth.openCookieGuide` 在系统浏览器打开一篇短文档(可指向 README 锚点)。

### D5:VSCode Backend 实现

```ts
// backends/vscode-secret.ts
class VSCodeSecretBackend implements SecretBackend {
  constructor(private secrets: vscode.SecretStorage) {}
  get(key)    { return this.secrets.get(key); }
  set(key, v) { return this.secrets.store(key, v); }
  delete(key) { return this.secrets.delete(key); }
}

// backends/vscode-config.ts
class VSCodeConfigBackend implements ConfigBackend {
  get<T>(key: string, defaultValue?: T): T {
    return vscode.workspace.getConfiguration('ojAgent').get<T>(key, defaultValue!);
  }
  onChange(listener) { /* workspace.onDidChangeConfiguration */ }
}

// backends/vscode-output-channel-logger.ts
class VSCodeOutputChannelLogger implements LoggerBackend {
  private ch = vscode.window.createOutputChannel('OJ-Agent', { log: true });
  info(scope, msg, extra)  { this.ch.appendLine(`[${scope}] ${msg} ${extra ? JSON.stringify(extra) : ''}`); }
  // warn/error 同理,带前缀
}
```

激活时构造一次,注入到 core(`PlatformAdapterRegistry / WorkspaceManager / JudgeRunner / SubmissionRunner` 等)。

### D6:状态栏

`vscode.window.createStatusBarItem(StatusBarAlignment.Left, 100)`,text `'$(rocket) OJ-Agent'`,tooltip 列出每平台登录状态。

提交中切换为 `'$(sync~spin) Judging…'`;完成 5 秒后切到短文本(`'$(check) AC 120ms'` 或 `'$(error) WA'`),再 10 秒隐藏。点击触发 `ojAgent.statusBar.openQuickPick` → QuickPick 列出动作。

### D7:配置项(package.json schema)

`ojAgent.workspace.root`(string, 默认 `${userHome}/oj-agent-workspace`)
`ojAgent.platforms.enabled`(string[], 默认 `['leetcode-cn','hdoj']`)
`ojAgent.http.proxy`(string, 默认 `''`)
`ojAgent.http.rateLimit.leetcode-cn`(integer, 默认 30, min 1)
`ojAgent.http.rateLimit.hdoj`(integer, 默认 60, min 1)
`ojAgent.lang.cpp.compile`、`ojAgent.lang.cpp.run`、`ojAgent.lang.python3.run`、`ojAgent.lang.java.compile`、`ojAgent.lang.java.run`、`ojAgent.lang.javascript.run`(string)
`ojAgent.judge.timeoutMs`(integer, 默认 3000, min 100, max 60000)
`ojAgent.submission.minIntervalMs`(integer, 默认 5000, min 0)
`ojAgent.submission.pollTimeoutMs`(integer, 默认 60000, min 1000)
`ojAgent.ui.defaultLang`(`cpp|python3|java|javascript`,默认 `cpp`)

不动现有 `ojAgent.ai.*` 任何项。

### D8:AI 联动(ai-assistant 增量)

只新增"上下文来源 · OJ 平台联动"小节,不动既有 Requirement:
- 题面 Webview 工具栏挂 4 个 AI 命令按钮,参数 `{ platform, id, slug }`
- 测试结果面板每个失败用例右侧挂"解释错因",参数附 `caseIndex` 与失败信息
- 新增 `ProblemContextProvider.get({ platform, id, slug })` 与 `TestCaseContextProvider.get({ problemRef, caseIndex })`,经 core 的 `context-builder` 在打包前调用以拿到题面 Markdown、代码、失败用例
- 未配置 Profile 时按按钮 disable(`ai-assistant` 已有规范)

### D9:测试策略

- `views/problem-tree.test.ts`:mock registry,验证两层结构、筛选 / 分页查询透传
- `views/problem-webview.test.ts`:mock vscode webview,验证 message 路由(运行 / 提交 / 刷新 / AI)
- `views/judge-panel.test.ts`:模拟 `JudgeRunResult` → 渲染 HTML 字符串快照
- `backends/vscode-secret.test.ts`:用 `vscode-test` 起 Extension Host
- `backends/vscode-config.test.ts`:onDidChangeConfiguration 触发回调
- `status-bar.test.ts`:状态切换的文本序列
- 端到端:`@vscode/test-electron` 起 Extension Host,执行 `ojAgent.platform.pullByUrl` 命令验证 problemDir 写盘

## Risks / Trade-offs

- **HDOJ Webview 跨域 cookie 读取** → 若 VSCode Webview 沙箱阻止 `document.cookie`,登录会失败。Mitigation:实现前先在 `chrome-devtools` 中验证 webview 可读 cookie;失败时降级走 CLI 同款"账号+密码 form POST"路径(代码已在 CLI change 内实现,可拆出共享)。
- **Markdown 渲染体积** → katex+markdown-it 增加扩展体积。Mitigation:lazy import(webview 首次打开时再加载);katex 字体不打包,改用 CDN(若离线场景需要支持再切回本地)。**M1 优先离线**,接受体积。
- **Webview CSP 严格但 LeetCode 题面含外链图片** → 图片不显示。Mitigation:`img-src` 加 `https:`,但禁止其它资源类型。
- **状态栏抢占** → 与其他扩展状态栏混在一起。Mitigation:priority=100 居中偏左,文字短。
- **AI 入口 disable 状态同步** → Profile 变化时按钮未刷新。Mitigation:监听 `ai.activeProfileId` 配置变更,`webview.postMessage({ type: 'aiAvailableChanged', enabled })`。
- **HttpOnly Cookie 兼容性** → 同 CLI,LeetCode CN 无解,M1 接受粘贴方案。
- **markdown-it-katex 与新版 markdown-it 兼容** → 可能需要 `@iktakahiro/markdown-it-katex` 或 `markdown-it-texmath`。Mitigation:实现时选稳定可维护包,若 `markdown-it-katex` 已 unmaintained 改用 `markdown-it-texmath`。

## Migration Plan

无既有 OJ UI;本变更全新增。已有 14 条 AI 命令、AI Profiles / Actions TreeView、AI 对话面板严格保留。

新增配置项第一次启动时给默认值,不需要迁移已有用户数据。`ojAgent.platforms.enabled` 作为功能开关:数组为空时不注册任何 OJ 命令、TreeView 不显示,等同于旧版行为。

回滚:本变更仅动 `packages/vscode/*`,不影响 core 与 cli。

## Open Questions

- Webview Cookie 读取在 1.94+ 的 VSCode Webview 中是否可靠?——实现前用 `chrome-devtools` 验证;失败则改走 form POST。
- 是否在 M1 内提供 `ojAgent.problems` 的"已拉取本地题目"分组?——倾向**否**,M1 列表只来自远端;本地视图留到 M2。
- 状态栏是否要分两个 Item(登录态 + 提交进度)?——倾向**否**,单 Item 文本切换更省屏幕空间;PRD 也未要求。
- markdown-it-katex 选哪个包?——交给实现阶段调研,本设计不预设。

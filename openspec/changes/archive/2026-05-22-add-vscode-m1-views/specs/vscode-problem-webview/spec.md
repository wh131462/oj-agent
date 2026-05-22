## ADDED Requirements

### Requirement: Webview 注册

扩展 SHALL 实现题面 Webview,viewType `ojAgent.problemView`,通过 `vscode.window.createWebviewPanel` 创建。每个 `(platform, id)` 对应一个 panel 实例;再次打开同一题 MUST 复用已有 panel(`reveal`),MUST NOT 创建重复。

Webview options:
- `enableScripts: true`
- `retainContextWhenHidden: true`(切换 tab 不重置状态)
- `localResourceRoots`:`[extensionUri/resources, problemDir.uri]`

CSP Header(meta 标签注入):
```
default-src 'none';
img-src ${webview.cspSource} https: data:;
style-src ${webview.cspSource} 'nonce-${nonce}';
script-src 'nonce-${nonce}';
font-src ${webview.cspSource};
```

#### Scenario: 复用 panel
- **WHEN** 已打开 `(leetcode-cn, 1)` 题面 panel,再次触发 `ojAgent.platform.openProblemView({ platform: 'leetcode-cn', id: '1' })`
- **THEN** 现有 panel 被 `reveal`,不新建

### Requirement: Markdown 与 KaTeX 渲染

Webview SHALL 使用 `markdown-it` + KaTeX 插件渲染 `problem.md`:
- 行内代码、fenced code 保持原样,使用 prism 或 highlight.js 着色(可省略,但 fenced code 标签需保留 `<pre><code class="language-X">`)
- 数学公式 `$...$`、`$$...$$` MUST 被渲染为 KaTeX
- 题面 `<img src="...">` 若为绝对 https URL 直接保留;若为相对路径 MUST 用 `webview.asWebviewUri` 重写

KaTeX 字体与 CSS MUST 从扩展打包的 `resources/katex/` 加载(离线可用),MUST NOT 走 CDN。

#### Scenario: 数学公式渲染
- **WHEN** 题面包含 `$O(n \\log n)$`
- **THEN** Webview 中该位置渲染为 KaTeX HTML(`<span class="katex">`),非纯文本

#### Scenario: 离线打开题面
- **WHEN** 无网络,打开已拉取的题面
- **THEN** 题面与公式正常渲染,无任何 CDN 请求

### Requirement: 工具栏与消息协议

Webview 顶部 SHALL 渲染 8 个工具栏按钮(用 vscode-codicons 字体):
1. `$(run)` 运行所有用例 → 发 `{ type: 'cmd', cmd: 'judge.runAll' }`
2. `$(cloud-upload)` 提交 → `{ type: 'cmd', cmd: 'submission.submit' }`
3. `$(refresh)` 刷新题面 → `{ type: 'cmd', cmd: 'platform.refreshProblem' }`
4. `$(go-to-file)` 打开代码 → `{ type: 'cmd', cmd: 'editor.openSolution' }`
5. `$(comment-discussion)` AI 解释错因 → `{ type: 'cmd', cmd: 'ai.explainError', args: { problemRef } }`
6. `$(lightbulb)` AI 生成思路 → `{ type: 'cmd', cmd: 'ai.generateApproach', args }`
7. `$(book)` AI 生成题解 → `{ type: 'cmd', cmd: 'ai.generateSolution', args }`
8. `$(symbol-method)` AI 解释代码 → `{ type: 'cmd', cmd: 'ai.explainCode', args }`

扩展端 SHALL 监听 `webview.onDidReceiveMessage`,按 `cmd` 字符串路由到对应 `vscode.commands.executeCommand('ojAgent.<cmd>', args)`。

#### Scenario: 运行按钮路由
- **WHEN** 用户点击运行按钮
- **THEN** 扩展接收 `{ type: 'cmd', cmd: 'judge.runAll' }`,调用 `vscode.commands.executeCommand('ojAgent.judge.runAll', { problemDir })`,触发本地测试结果面板

#### Scenario: AI 按钮 disable 状态
- **WHEN** `ojAgent.ai.activeProfileId === ''`(未配置 Profile)
- **THEN** 4 个 AI 按钮 className 含 `disabled`,鼠标悬停 tooltip `'请先添加 AI Profile'`,点击不发消息

### Requirement: 题面数据传递

扩展 SHALL 在 webview 初始化时通过 `postMessage` 向 webview 推送 `{ type: 'init', payload: { problemRef, markdownHtml, meta, aiEnabled } }`;问题刷新后推送 `{ type: 'init', ... }` 替换内容。Webview MUST 不直接读取本地文件(由扩展统一传)。

#### Scenario: 刷新覆盖
- **WHEN** 扩展执行 `ojAgent.platform.refreshProblem` 成功,推送新 init
- **THEN** webview 用新 markdownHtml 覆盖,工具栏状态保留

### Requirement: 标题与图标

Panel 标题 SHALL 设为 `'<platform>: <id>. <title>'`(如 `LeetCode CN: 1. 两数之和`),iconPath 用扩展资源中的 platform logo 或通用 `resources/problem.svg`。

#### Scenario: 标题展示
- **WHEN** 打开 `(leetcode-cn, 1)`
- **THEN** Tab 标签为 `LeetCode CN: 1. 两数之和`

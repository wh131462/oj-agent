## MODIFIED Requirements

### Requirement: 工具栏与消息协议

Webview 顶部 SHALL 渲染 9 个工具栏按钮(用 vscode-codicons 字体):
1. `$(run)` 运行所有用例 → 发 `{ type: 'cmd', cmd: 'judge.runAll' }`
2. `$(cloud-upload)` 提交 → `{ type: 'cmd', cmd: 'submission.submit' }`
3. `$(refresh)` 刷新题面 → `{ type: 'cmd', cmd: 'platform.refreshProblem' }`
4. `$(go-to-file)` 打开代码 → `{ type: 'cmd', cmd: 'editor.openSolution' }`
5. `$(folder-opened)` 打开目录 → `{ type: 'cmd', cmd: 'platform.revealProblemDir' }`
6. `$(comment-discussion)` AI 解释错因 → `{ type: 'cmd', cmd: 'ai.explainError', args: { problemRef } }`
7. `$(lightbulb)` AI 生成思路 → `{ type: 'cmd', cmd: 'ai.generateApproach', args }`
8. `$(book)` AI 生成题解 → `{ type: 'cmd', cmd: 'ai.generateSolution', args }`
9. `$(symbol-method)` AI 解释代码 → `{ type: 'cmd', cmd: 'ai.explainCode', args }`

扩展端 SHALL 监听 `webview.onDidReceiveMessage`,按 `cmd` 字符串路由到对应 `vscode.commands.executeCommand('ojAgent.<cmd>', args)`。新增的 `platform.revealProblemDir` MUST 接收当前题目的 `ProblemRef` 作为参数,扩展端再解析出 problemDir 并调用 `revealFileInOS`。

#### Scenario: 运行按钮路由
- **WHEN** 用户点击运行按钮
- **THEN** 扩展接收 `{ type: 'cmd', cmd: 'judge.runAll' }`,调用 `vscode.commands.executeCommand('ojAgent.judge.runAll', { problemDir })`,触发本地测试结果面板

#### Scenario: 打开目录按钮
- **WHEN** 用户点击 `$(folder-opened)` 打开目录按钮
- **THEN** 扩展接收 `{ type: 'cmd', cmd: 'platform.revealProblemDir', args: { platform, id, slug } }`,在系统资源管理器中展开题目目录;若 problemDir 不存在则弹 Notification `'题目尚未拉取到本地'`

#### Scenario: AI 按钮 disable 状态
- **WHEN** `ojAgent.ai.activeProfileId === ''`(未配置 Profile)
- **THEN** 4 个 AI 按钮 className 含 `disabled`,鼠标悬停 tooltip `'请先添加 AI Profile'`,点击不发消息

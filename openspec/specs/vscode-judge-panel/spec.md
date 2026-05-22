# vscode-judge-panel Specification

## Purpose

定义 VSCode 扩展端本地测试结果 Webview(`ojAgent.judgeResult`)的注册、渲染、增量更新、用例操作与 AI 入口挂载等行为规范,作为 `submission-runner` 流式事件在 IDE 内的可视化承载。

## Requirements

### Requirement: 测试结果 Webview

扩展 SHALL 实现本地测试结果 Webview,viewType `ojAgent.judgeResult`。Webview 与题面 Webview 是独立 panel,可同时存在;每题最多一个 judgeResult panel(再次运行复用)。

`enableScripts: true`、`retainContextWhenHidden: true`、严格 CSP(同题面 Webview)。

#### Scenario: 同题复用面板
- **WHEN** 用户在 problem A 上连续运行两次测试
- **THEN** 仅存在一个 judgeResult panel,内容被新结果替换

#### Scenario: 不同题独立
- **WHEN** 用户切换到 problem B 运行测试
- **THEN** 新建 problem B 的独立 panel,problem A 的 panel 保留

### Requirement: 结果数据流

扩展 SHALL 在 `JudgeRunner.runAll` 返回后,通过 `panel.webview.postMessage({ type: 'result', payload })` 把整 `JudgeRunResult`(含每 case 的 input/expected/actual/diff/verdict/timeMs/stderr)推送到 webview。Webview MUST NOT 自行读取本地文件。

#### Scenario: 结果推送
- **WHEN** `runAll` 返回 `{ cases: [3 个], compileError: undefined }`
- **THEN** webview 收到 `{ type: 'result', payload }`,渲染 3 条 case 卡片

### Requirement: 用例卡片渲染

每个 case 卡片 SHALL 显示:
- verdict 徽章(AC 绿、WA 红、TLE 黄、RE 红、CE 红)
- index、timeMs、stdout 字符数
- 折叠的 `Input` / `Expected` / `Actual` 三块(默认折叠;WA 时 Actual 展开)
- WA 情形下显示 unified diff(高亮 first-diff 行的列号)

#### Scenario: AC 卡片折叠
- **WHEN** case verdict=AC
- **THEN** Input/Expected/Actual 默认折叠,无 diff 显示

#### Scenario: WA 卡片展开 diff
- **WHEN** case verdict=WA,first-diff line=2 col=3
- **THEN** Actual 与 Expected 默认展开,unified diff 区中第 2 行第 3 列以 `^` 或高亮标识

### Requirement: 编译错误展示

`payload.compileError` 非空时,Webview SHALL 在顶部显示醒目错误条,内容为完整 stderr(可滚动 / 复制),并隐藏全部 case 卡片(因为根本没跑)。

#### Scenario: CE 渲染
- **WHEN** payload `compileError: "error: expected ';'"`,`cases: []`
- **THEN** 顶部红色错误条显示完整 stderr,下方提示"未执行任何用例"

### Requirement: AI 解释错因按钮

WA / TLE / RE / CE 的 case 卡片 SHALL 右侧挂 `[AI: 解释错因]` 按钮。点击 MUST 通过 webview message 路由到 `ojAgent.ai.explainError`,args 包含:
```ts
{
  platform, id, slug, caseIndex,
  input, expected, actual, diffSummary,
  language, sourceCode, verdict
}
```

未配置 AI Profile 时按钮 disabled(与题面 Webview 行为一致)。

#### Scenario: 失败用例 AI 按钮
- **WHEN** case 2 verdict=WA,用户点击 `[AI: 解释错因]`
- **THEN** 扩展接收 message → 执行 `vscode.commands.executeCommand('ojAgent.ai.explainError', { platform, id, caseIndex: 2, ... })`,触发 ai-assistant 既有流程

#### Scenario: AC case 无按钮
- **WHEN** case 1 verdict=AC
- **THEN** 该卡片不显示 AI 按钮

### Requirement: 重跑按钮

Panel 顶部 summary 区 SHALL 有 `[重跑全部]` 按钮(`$(refresh)`),点击触发 `ojAgent.judge.runAll` 对当前 problemDir 重跑。在运行中 MUST 显示 `$(sync~spin) Running...` 并禁用按钮。

#### Scenario: 重跑
- **WHEN** 点击 `[重跑全部]`
- **THEN** 触发新一次 runAll,UI 进入 spinner 状态;完成后 spinner 消失,新结果替换

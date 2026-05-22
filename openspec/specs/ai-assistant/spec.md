# ai-assistant Specification

## Purpose

定义 OJ-Agent 内 AI 助手能力的统一入口、流式输出、上下文打包、隐私脱敏、速率限制与命令面板集成等行为规范。

## Requirements

### Requirement: AI 助手统一入口

系统 SHALL 在题面 Webview、本地测试结果面板与命令面板中提供四类 AI 操作入口：**解释错因**、**生成解题思路**、**生成完整题解**、**解释当前代码**。当用户未配置任何可用的模型 Profile 时，入口 SHALL 显示为禁用状态并提示前往设置。

#### Scenario: 未配置模型时禁用入口

- **WHEN** 用户打开题面 Webview 且未配置任何 AI Profile
- **THEN** 四个 AI 按钮显示为禁用状态，悬浮提示 "请先在设置中添加 AI 模型 Profile"，点击后跳转至 `OJ-Agent: 切换 AI 模型 Profile` 命令

#### Scenario: 在测试失败结果上解释错因

- **WHEN** 用户在本地测试结果面板对某个失败用例点击"解释错因"
- **THEN** 系统将题面、当前代码、该用例的输入/期望输出/实际输出/diff 打包为提示词，发起 AI 流式请求，并在 AI 面板中逐字渲染答复

### Requirement: 流式输出与中断

系统 SHALL 以流式逐 token/事件渲染 AI 回答，并在 AI 面板提供"停止生成"按钮可随时中断。中断 SHALL 立即关闭底层 HTTP 流并保留已渲染内容。

#### Scenario: 中途停止生成

- **WHEN** AI 正在流式输出回答，用户点击"停止生成"
- **THEN** 底层 HTTP 连接在 1 秒内关闭，UI 状态从"生成中"切换为"已停止"，已生成内容保留可复制

#### Scenario: 网络错误降级

- **WHEN** 流式请求中途网络断开
- **THEN** UI 显示具体错误信息（HTTP 状态码或网络错误），并提供"重试"按钮，已生成内容保留

### Requirement: 上下文打包与预览

系统 SHALL 在发起 AI 请求前根据用户所选动作自动打包上下文（题面、样例、当前代码、失败用例 diff 等），并 SHALL 提供"预览/编辑提示词"选项允许用户在发送前修改。

#### Scenario: 解释代码动作的上下文

- **WHEN** 用户对当前代码选区触发"解释当前代码"
- **THEN** 提示词包含题面摘要 + 选中代码（若无选区则包含整文件），且不包含本地测试结果

#### Scenario: 用户编辑后发送

- **WHEN** 用户在预览面板中编辑提示词并点击"发送"
- **THEN** 系统使用编辑后的内容发起请求，不再追加默认上下文

### Requirement: 上下文长度保护

系统 SHALL 在发送请求前估算上下文长度，当超过当前 Profile 配置的 `maxInputTokens` 时 SHALL 截断（优先保留题面 + 失败用例摘要，舍弃多余代码或样例），并在 UI 中以警示标签提示用户已截断的部分。

#### Scenario: 上下文过长时截断

- **WHEN** 上下文估算长度超过 `maxInputTokens`
- **THEN** 系统按优先级（题面 > 失败用例 > 当前代码 > 其他样例）截断，UI 显示"已省略 N 个样例"提示

### Requirement: 隐私脱敏

系统 SHALL 默认对发送给 AI 的上下文执行脱敏：剥离 OJ 用户名、提交 ID、Cookie/Token 等凭证类字段；用户 SHALL 能在设置中关闭脱敏。

#### Scenario: 默认脱敏

- **WHEN** 用户首次使用 AI 功能且未修改默认设置
- **THEN** 发送给 AI 端点的请求体中不包含 `username`、`submissionId`、`Cookie`、`Authorization`（除 AI 端点本身的 Bearer Key）等字段

### Requirement: 速率限制

系统 SHALL 对 AI 请求实施速率限制：默认每分钟最多 20 次请求；当超出限制时 SHALL 拒绝新请求并提示用户等待。该限制 SHALL 可在设置中调整。

#### Scenario: 超过速率限制

- **WHEN** 用户在 1 分钟内发起第 21 次 AI 请求
- **THEN** 该请求被立即拒绝，UI 提示"AI 请求超出速率限制，请在 N 秒后重试"，N 为距下一可用时间窗口的秒数

### Requirement: 命令面板入口

系统 SHALL 注册以下 VSCode 命令：`ojAgent.ai.explainError`、`ojAgent.ai.generateApproach`、`ojAgent.ai.generateSolution`、`ojAgent.ai.explainCode`、`ojAgent.ai.switchProfile`。所有命令 SHALL 不绑定默认快捷键。

#### Scenario: 命令面板可发现

- **WHEN** 用户在命令面板输入 "OJ-Agent: AI"
- **THEN** 上述 5 个命令全部出现在候选列表中

### Requirement: OJ 平台联动上下文来源

系统 SHALL 把题面 Webview(`ojAgent.problemView`)与本地测试结果面板(`ojAgent.judgeResult`)作为 AI 入口的主要承载位置。两个面板各自的工具栏 / 失败用例旁挂载已有的 `ojAgent.ai.explainError / generateApproach / generateSolution / explainCode` 命令,调用时 MUST 传入参数对象以便 `context-builder` 组装上下文。

参数对象形态:
```ts
type ProblemRef = { platform: PlatformId; id: string; slug: string };
type ExplainErrorArgs = ProblemRef & {
  caseIndex: number;
  input: string;
  expected: string;
  actual: string;
  diffSummary?: string;
  verdict: 'WA' | 'TLE' | 'RE' | 'CE';
  language: 'cpp' | 'python3' | 'java' | 'javascript';
  sourceCode: string;
};
type GenericAIArgs = ProblemRef & {
  language?: string;
  sourceCode?: string;
};
```

`ProblemContextProvider.get(ref)` SHALL 从 `WorkspaceManager` 读取 `problem.md / meta.json / solution.<ext>` 组装 `ProblemContext`;`TestCaseContextProvider.get(ref, caseIndex)` SHALL 组装 `TestCaseContext`。两个 provider 在扩展激活时 MUST 注册到 core 的 `context-builder`,使既有 AI 命令在 `ojAgent.*.problemRef` 参数存在时自动调用 provider 拿到完整上下文。

#### Scenario: 题面工具栏触发"生成思路"

- **WHEN** 用户在题面 Webview 工具栏点击"生成思路"按钮,题面是 LeetCode CN `two-sum`
- **THEN** 扩展执行 `ojAgent.ai.generateApproach`,参数 `{ platform: 'leetcode-cn', id: '1', slug: 'two-sum', language: 'cpp', sourceCode: '<solution.cpp 内容>' }`;`context-builder` 调用 `ProblemContextProvider.get` 拿到 markdown + samples,按既有 `Requirement: 上下文打包与预览` 流程发送给 AI

#### Scenario: 失败用例触发"解释错因"

- **WHEN** 用户在测试结果面板 case 2(WA)点击"解释错因"
- **THEN** 扩展执行 `ojAgent.ai.explainError`,args 含 `caseIndex: 2 / input / expected / actual / diffSummary / sourceCode`;`TestCaseContextProvider.get(ref, 2)` 组装完整 `TestCaseContext`,按既有 `Requirement: AI 助手统一入口` 中"在测试失败结果上解释错因"场景流程渲染答复

#### Scenario: 未配置 Profile 时禁用

- **WHEN** `ojAgent.ai.activeProfileId === ''`
- **THEN** 题面 Webview 与测试结果面板中 4 个 AI 按钮显示为 disabled,符合既有 `Requirement: AI 助手统一入口` 的"未配置模型时禁用入口"场景

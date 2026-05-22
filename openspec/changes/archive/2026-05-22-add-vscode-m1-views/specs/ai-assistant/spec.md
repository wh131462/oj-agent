## ADDED Requirements

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

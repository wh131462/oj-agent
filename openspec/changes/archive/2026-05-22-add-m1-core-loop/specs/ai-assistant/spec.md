## ADDED Requirements

### Requirement: 上下文来源（题面 Webview 与测试结果面板）

系统 SHALL 在题面 Webview 与测试结果面板中提供四类 AI 入口（解释错因 / 生成解题思路 / 生成完整题解 / 解释当前代码）。每次点击 MUST 由扩展宿主通过 `ProblemContextProvider` / `TestCaseContextProvider` 组装 `ProblemContext` 与 `TestCaseContext`，再交付既有 `context-builder`。

`ProblemContext` MUST 包含：`{ platform, id, slug, title, difficulty, tags[], markdown, limits, samples }`。
`TestCaseContext` MUST 包含：`{ caseIndex, input, expected, actual, diffSummary, verdict, language, sourceCode }`。

#### Scenario: 在题面挂载入口

- **WHEN** 用户在题面 Webview 点击「生成解题思路」
- **THEN** 扩展宿主 SHALL 通过 `ProblemContextProvider.get(problemRef)` 返回完整 `ProblemContext`，传入 `context-builder`，最终按既有规范流式渲染答复

#### Scenario: 在失败用例上挂载入口

- **WHEN** 用户在测试结果面板点击 case #2 旁的「解释错因」
- **THEN** 扩展宿主 SHALL 同时获取 `ProblemContext` 与该用例的 `TestCaseContext` 并交付 `context-builder`

### Requirement: 入口禁用规则联动

四个 AI 入口的禁用规则 MUST 沿用现有 `ai-assistant` 规范（未配置 Profile 时禁用），不在本规范重复定义。题面 Webview 与结果面板 MUST 监听 `ojAgent.ai.activeProfileId` 变化并实时刷新按钮状态。

#### Scenario: Profile 变更后按钮即时启用

- **WHEN** 用户在「测试结果」面板时通过命令切换到有效 Profile
- **THEN** 失败用例旁的「解释错因」按钮 SHALL 在 500ms 内由禁用变为可点击

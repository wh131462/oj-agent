## ADDED Requirements

### Requirement: 题库 TreeView

系统 SHALL 在 OJ-Agent 视图容器中提供 TreeView `ojAgent.problems`，第一层为平台节点（LeetCode CN / HDOJ），第二层为题目列表。每个题目 MUST 显示 `[id] title` 与难度图标（绿 / 黄 / 红）。

#### Scenario: 展开 LeetCode CN

- **WHEN** 用户展开 `LeetCode CN`
- **THEN** TreeView SHALL 异步加载第 1 页题目，loading 时显示骨架占位

### Requirement: 分页与搜索筛选

TreeView 工具栏 MUST 提供「搜索」「难度筛选」「标签筛选」「下一页 / 上一页」按钮。当前页码 MUST 在 TreeView 顶部以 `Page X / Y` 形式显示。筛选条件 MUST 持久化到 `workspaceState`，重启后恢复。

#### Scenario: 搜索关键字

- **WHEN** 用户在 LeetCode CN 节点点击「搜索」并输入「dp」
- **THEN** TreeView 仅渲染包含 `dp` 的题目，标题栏显示 `Filter: keyword="dp"`

### Requirement: 拉取动作

用户右键题目节点 MUST 看到「拉取到本地」「在浏览器打开」「复制题号」操作。「拉取到本地」MUST 调用 `problem-workspace` 创建目录并打开题面 Webview。

#### Scenario: 拉取触发目录创建

- **WHEN** 用户右键「两数之和」选「拉取到本地」
- **THEN** 工作区出现 `leetcode-cn/1-two-sum-2026-05-21/` 目录，题面 Webview 自动打开

### Requirement: 题面 Webview

题面 Webview MUST 使用 `markdown-it` + `markdown-it-katex` 渲染 `problem.md`。Webview 工具栏 MUST 包含：「运行所有用例」「提交」「刷新题面」「打开代码」与四个 AI 入口按钮（解释错因 / 生成思路 / 生成题解 / 解释代码）。AI 按钮的禁用态 MUST 遵循 `ai-assistant` 规范。

#### Scenario: 渲染 LaTeX

- **WHEN** 题面 Markdown 含 `$E = mc^2$`
- **THEN** Webview SHALL 通过 KaTeX 正确渲染数学公式

#### Scenario: 点击 AI 入口

- **WHEN** 用户点击「生成解题思路」按钮
- **THEN** Webview `postMessage({type:'ai.generateApproach', problemRef:{platform, id}})`，宿主路由到 `ojAgent.ai.generateApproach` 命令

### Requirement: 命令面板入口

系统 SHALL 注册以下命令并出现在命令面板：
- `OJ-Agent: 拉取题目（按 URL）`
- `OJ-Agent: 运行所有用例`
- `OJ-Agent: 添加自定义用例`
- `OJ-Agent: 提交当前代码`
- `OJ-Agent: 打开题面`
- `OJ-Agent: 登录 LeetCode CN`
- `OJ-Agent: 登录 HDOJ`
- `OJ-Agent: 登出 <Platform>`
- `OJ-Agent: 切换工作区根目录`

#### Scenario: 按 URL 拉取

- **WHEN** 用户执行 `OJ-Agent: 拉取题目（按 URL）` 并粘贴 `https://leetcode.cn/problems/two-sum/`
- **THEN** 系统识别平台与 slug，按既有流程拉取并打开 Webview

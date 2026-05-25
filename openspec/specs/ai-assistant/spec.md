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

### Requirement: 对话历史持久化

系统 SHALL 在扩展 `globalState` 中以键 `ai.conversations` 持久化所有 AI 助手会话。每条会话 MUST 至少包含 `id`、`title`、`topic`、`systemPrompt`、`messages`、`profileId`、`createdAt`、`updatedAt` 字段。会话数 SHALL 上限为 50 条，超出时按 `updatedAt` 升序丢弃最旧记录。

#### Scenario: 重启扩展后历史恢复

- **WHEN** 用户与 AI 进行了至少一轮问答后关闭 VSCode 并重新打开扩展
- **THEN** AI 面板的历史浮层 SHALL 显示该会话条目，点击后消息内容完整恢复（含 user/assistant 顺序与渲染后的 markdown）

#### Scenario: 会话数达到上限自动淘汰

- **WHEN** 当前已存在 50 条会话且用户新建第 51 条
- **THEN** 系统 SHALL 删除 `updatedAt` 最早的 1 条会话，使总数保持 50；被淘汰的会话不可恢复

#### Scenario: 首次升级无历史不报错

- **WHEN** 用户从旧版本升级后首次打开 AI 面板，且 `globalState` 中无 `ai.conversations` 键
- **THEN** 系统 SHALL 视为空数组，UI 渲染空历史浮层，不抛出异常

### Requirement: 新建空对话

系统 SHALL 提供"新建对话"入口（AI 面板 header 按钮 + 命令 `ojAgent.ai.newConversation`）。点击 SHALL 在历史浮层顶部插入一条新会话并立即切换到该会话；新会话的 `messages` 为空、`topic` 为空串、`systemPrompt` 使用默认教练 prompt、`profileId` 取当前活跃 Profile id。

#### Scenario: 通过按钮新建对话

- **WHEN** 用户在 AI 面板 header 点击"新建对话"按钮
- **THEN** 历史浮层顶部 SHALL 出现一条标题为"新对话"的会话条目，主视图切到该空会话，messages 区显示初始的 empty state 引导

#### Scenario: 通过命令面板新建对话

- **WHEN** 用户在命令面板执行 `ojAgent.ai.newConversation`
- **THEN** 若 AI 面板未打开则先打开面板，随后行为与按钮触发一致

#### Scenario: 新建与清空语义区分

- **WHEN** 用户对一个已有 5 条消息的会话点击"清空对话"
- **THEN** 该会话 messages 被清空但会话条目仍在历史中；与"新建对话"不同，新建会在历史中留下原会话并创建一条新的

### Requirement: 历史会话列表与切换

系统 SHALL 在 AI 面板内提供历史会话入口（header 上的"历史"按钮，点击弹出浮层列表）。列表 SHALL 按 `updatedAt` 倒序展示所有会话，含标题与相对时间；支持点击切换、双击/菜单重命名、删除三种操作。切换会话 MUST **不中断**正在进行的流式请求：原会话的流在后台继续运行；切回原会话时，UI SHALL 自动恢复流式渲染并显示当前累积内容。

#### Scenario: 切换会话时后台流不中断

- **WHEN** AI 正在为会话 A 流式输出回答，用户点击历史浮层切到会话 B
- **THEN** 会话 A 的 HTTP 流 SHALL **继续在后台运行**；主视图切到会话 B 并渲染其历史；用户再切回会话 A 时 SHALL 看到流式回答继续滚动直至完成

#### Scenario: 重命名会话

- **WHEN** 用户在浮层对某会话双击标题或点击"重命名"图标并输入新标题"二分查找"
- **THEN** 该会话的 `title` 更新为"二分查找"，`updatedAt` 刷新；浮层标签同步显示新名

#### Scenario: 删除当前会话

- **WHEN** 用户删除当前正在查看的会话
- **THEN** 系统 SHALL 弹出确认对话框；确认后该会话被移除，主视图切到历史中最新的另一条会话；若历史为空则自动新建一条空会话

#### Scenario: 浮层外部点击关闭

- **WHEN** 用户打开历史浮层后点击页面其他区域
- **THEN** 浮层 SHALL 自动关闭（通过透明 mask 捕获点击事件实现）

### Requirement: 模型展示位置与底部快捷切换

系统 SHALL 把当前活跃 Profile 的展示位置从面板 header 迁移到 composer 卡片**内部**的底部工具栏；工具栏 MUST 提供 Profile 选择器（chip 样式，含状态点 + 当前 Profile 名 + 下拉箭头），允许用户在不离开对话上下文的情况下切换活跃 Profile。切换后 SHALL 仅影响后续请求，不修改已有消息或会话的 `profileId` 字段。

#### Scenario: composer 内展示当前 Profile

- **WHEN** 用户打开 AI 面板且已存在至少一个 Profile
- **THEN** composer 卡片底部工具栏 SHALL 显示形如 `● gpt-4o ▾` 的 chip，绿点指示活跃；面板 header 不再展示 profile badge

#### Scenario: chip 切换 Profile

- **WHEN** 用户点击 composer 工具栏的 Profile chip，弹出原生菜单选择另一个 Profile "claude-sonnet"
- **THEN** 系统 SHALL 调用 `ProfileStore.setActive('claude-sonnet')`，chip 标签立即更新；当前会话的已有消息保持不变；用户下次发送消息时使用新 Profile 发起请求

#### Scenario: 未配置 Profile 时禁用选择器

- **WHEN** 用户打开 AI 面板且 `ProfileStore.list()` 为空
- **THEN** chip SHALL 显示为禁用，标签显示"未配置"，绿点变灰；点击 chip 提示并跳转设置面板

### Requirement: 流式任务与会话绑定

系统 MUST 把每个流式请求与发起它的 `conversationId` 绑定。流式产生的所有 chunk 与最终 commit 的 assistant 文本 SHALL 写入**发起请求的会话**而非当前正在查看的会话。Webview 端 SHALL 按 `conversationId` 过滤流式更新事件，仅当用户正在查看对应会话时才更新 UI。

#### Scenario: 切走后旧会话在后台收尾

- **WHEN** 用户在会话 A 发起请求，AI 流到一半时用户切到会话 B；随后会话 A 的流自然完成
- **THEN** 完成时累积的 assistant 文本 SHALL 写入会话 A 的 messages，会话 A 的 `updatedAt` 更新；会话 B 的视图不出现该消息

#### Scenario: 切回原会话恢复流式渲染

- **WHEN** 用户在会话 A 流式生成中切到 B，再切回 A
- **THEN** UI SHALL 自动追加 assistant 气泡并把已累积的内容补渲染一次；后续 chunk 继续实时更新气泡直至完成

## Why

当前 AI 助手面板（`AIPanel`）只维护**单一会话**：每次从题面工具栏触发新动作或点击"清空对话"，原有对话内容即被覆盖丢失，用户无法回看历史问答。同时，活跃 Profile 仅以小徽标形式显示在 header 角落，切换模型必须打开命令面板或设置面板，操作路径长。这两点让多题目并行学习、跨会话对比模型回答的场景变得困难。

## What Changes

- **会话历史持久化**：将 AI 助手的对话从内存中的单一会话改为**多会话列表**，按会话 ID 持久化到 `globalState`；每条会话包含标题、`topic`、`systemPrompt`、消息列表、所用 Profile ID、创建/更新时间。
- **历史侧栏（History Drawer）**：AI 面板新增可折叠的历史侧栏，列出所有会话（按更新时间倒序），支持点击切换、重命名、删除。
- **新建空对话入口**：header 增加"新建对话"按钮，点击后立即创建一个空会话并切到对应视图，与现有"清空当前对话"区分（清空作用于当前会话，新建则保留旧会话）。
- **模型展示位置迁移**：将 header 顶部的 profile badge 移到**对话框（composer）上方**作为状态条的一部分，更靠近用户输入区，提高视觉权重。
- **底部快捷模型切换**：在 composer 内嵌入 Profile 下拉选择器，用户可在不离开对话上下文的情况下切换激活 Profile，切换后**仅影响下一轮请求**（不重写已有消息），并把所选 Profile 持久化为全局 active。
- 命令面板新增 `ojAgent.ai.newConversation`，与"新建对话"按钮共用逻辑。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `ai-assistant`: 新增对话历史、新建空对话、底部模型快捷切换等需求；调整 AI 面板的 UI 布局规范（模型展示位置）。

## Impact

- 代码：
  - `packages/vscode/src/extension/ai-panel.ts`：从单会话状态机重构为多会话管理器；webview HTML/CSS/JS 加入侧栏与底部 Profile 选择器。
  - `packages/vscode/src/extension/commands.ts` / `package.json`：新增 `ojAgent.ai.newConversation` 命令。
  - `packages/vscode/src/extension/services.ts`：新增 `ConversationStore`（基于 `globalState`）。
- 数据：在 `globalState` 引入 `ai.conversations` 键。**首次升级时无历史会话**，无需迁移。
- 依赖：无新增第三方依赖。
- 范围外：不修改 `core` 中的 AI runner、context-builder、profile-store；不改变 streaming 协议；不影响 CLI。

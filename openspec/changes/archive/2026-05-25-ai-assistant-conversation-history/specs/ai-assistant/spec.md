## ADDED Requirements

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

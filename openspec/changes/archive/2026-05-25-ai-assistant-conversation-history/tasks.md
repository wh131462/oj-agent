## 1. 数据层：ConversationStore

- [x] 1.1 在 `packages/vscode/src/extension/services.ts` 中定义 `Conversation` / `ConversationSummary` / `ChatMessage` 类型，导出
- [x] 1.2 新建 `packages/vscode/src/extension/services/conversation-store.ts`，封装基于 `globalState` 的 CRUD：`list() / get(id) / create(draft) / update(id, patch) / appendMessage(id, msg) / remove(id) / setTitle(id, title)`
- [x] 1.3 实现写操作 200ms debounce flush 到 `globalState`；list 与 get 直读内存副本
- [x] 1.4 实现 50 条上限淘汰：每次 create 后检查并删除最旧的，保证存储有界
- [x] 1.5 在 `services.ts` 的 `AIServices` 中注入 `ConversationStore` 实例
- [x] 1.6 启动时从 `globalState.get('ai.conversations')` 初始化，缺失视为空数组

## 2. 命令注册

- [x] 2.1 在 `packages/vscode/package.json` 的 `commands` 数组新增 `ojAgent.ai.newConversation`（标题"新建对话"，category "OJ-Agent: AI"）
- [x] 2.2 在 `packages/vscode/src/extension/commands.ts` 注册该命令，handler 调用 `AIPanel.open(ctx, services)` 并传一个 `{ newConversation: true }` 标志

## 3. AIPanel 重构：从单会话到多会话

- [x] 3.1 在 `ai-panel.ts` 顶部新增 `currentConversationId: string | null` 字段，移除原 `history / systemPrompt / topic / streaming` 中可由当前会话推导的部��
- [x] 3.2 把所有读写 `this.history` 的代码改为通过 `services.conversations` 操作当前会话
- [x] 3.3 `prepare(input)` 改为：若已有同 topic 会话且未完成（无 assistant 回复）则复用，否则新建会话；置 `currentConversationId` 并刷新 webview
- [x] 3.4 `prepareEmpty()` 改为：从 `services.conversations.list()` 取最新一条；若无则新建一条空会话
- [x] 3.5 流式任务绑定 `conversationId`：`runStream` 参数加 `conversationId`，`commitAssistant` 通过该 id 写回 store 而非 currentId
- [x] 3.6 `onMessage` 增加处理：`newConversation`、`switchConversation`、`renameConversation`、`deleteConversation`、`setActiveProfile`
- [x] 3.7 删除会话时若删除的是 currentId，自动切换到下一条或新建空会话
- [x] 3.8 增加 `AIPanel.refreshConversations()` 静态方法，被 ConversationStore 写入后调用，广播 `conversationsUpdated`

## 4. Webview 协议扩展

- [x] 4.1 更新 `WebviewMsgIn` 类型，新增 `newConversation / switchConversation / renameConversation / deleteConversation / setActiveProfile` 五种消息
- [x] 4.2 更新 `WebviewMsgOut` 类型，`init` 携带 `conversations: ConversationSummary[]`、`currentId: string`、`profiles: ProfileSummary[]`；新增 `conversationsUpdated`、`profilesUpdated` 两种事件
- [x] 4.3 `ProfileSummary = { id: string; label: string }` 类型加在 services.ts 共享

## 5. Webview UI：历史侧栏

- [x] 5.1 在 webview html 中新增 `.drawer` 容器，CSS 默认 width=0，展开时 width=200px；body 用 flex 横向布局
- [x] 5.2 在 header 新增 ☰ 切换按钮 与 + 新建按钮，去掉原 profile badge（保留 clear/settings）
- [x] 5.3 侧栏列表渲染：每项含标题、相对时间、hover 显示重命名/删除两个 icon-btn
- [x] 5.4 侧栏折叠状态用 webview `localStorage` 记忆（仅 UI 偏好，不上报 host）
- [x] 5.5 实现"双击标题进入重命名"：使用 contenteditable 或浮层 input

## 6. Webview UI：状态条 + Profile 下拉

- [x] 6.1 在 `#messages` 与 `.composer` 之间新增 `.status-bar`，含 Profile `<select>` 与脱敏指示
- [x] 6.2 `<select>` 选项由 `init.profiles` 渲染，`change` 事件发 `setActiveProfile` 给 host
- [x] 6.3 Profile 为空时 select 显示 "未配置" 并 disabled，点击提示并触发跳设置
- [x] 6.4 监听 `profilesUpdated` 事件刷新下拉选项与活跃项

## 7. 联调与边界

- [x] 7.1 验证场景：重启 VSCode 后历史会话恢复，点击切换内容完整
- [x] 7.2 验证场景：切换会话时正在进行的流被中断，已生成内容写入原会话
- [x] 7.3 验证场景：达到 50 条上限时最旧会话被淘汰
- [x] 7.4 验证场景：底部切换 Profile 后下一轮请求使用新 Profile，已有消息不变
- [x] 7.5 验证场景：删除当前会话后自动切到下一条或新建空会话
- [x] 7.6 验证未配置 Profile 时下拉禁用且引导跳转
- [x] 7.7 验证侧栏折叠状态在面板重开后保持

## 8. 文档与收尾

- [x] 8.1 检查 `packages/vscode/package.json` 命令是否齐全，无未注册命令
- [x] 8.2 跑 monorepo 内 typecheck 与 lint，确保无新增错误
- [ ] 8.3 手动冒烟：题面 → AI 入口 → 新建 → 切换 → 重命名 → 删除 → 切 Profile 全链路通畅

## Context

`AIPanel` 当前实现（`packages/vscode/src/extension/ai-panel.ts`）是一个**单例 + 单一会话**的结构：
- `AIPanel.current` 单例 WebviewPanel；
- 类内字段 `history: ChatMessage[]`、`systemPrompt`、`topic`、`streaming` 表示当下唯一会话；
- `prepare(input)` 或 `prepareEmpty()` 会**直接清空 history**重写状态；
- "清空对话"按钮也是直接置空 `history`；
- Profile 通过 `services.profiles.getActive()` 读全局，UI 只在 header 用一个 `<span class="profile">` 展示；切换 Profile 必须走命令 `ojAgent.ai.switchProfile`（QuickPick）。

这套结构在多题目场景下丢失上下文：用户解一道题时点了"生成思路"，又切到另一题点了"解释错因"，前者立即被覆盖。模型切换也需离开面板。

## Goals / Non-Goals

**Goals:**
- 在 VSCode 扩展层引入多会话管理，把当前内存中的单一会话扩展为可持久化的会话列表。
- 提供清晰的"新建空对话 / 切换会话 / 删除会话"操作路径，与"清空当前会话"语义解耦。
- 把模型展示与切换入口下沉到 composer 附近，减少操作距离。
- 保持现有 `runner` / `context-builder` / `ProfileStore` 接口不变，所有改动局限在 `vscode` 包内。

**Non-Goals:**
- 不引入跨设备同步：会话仅存在本机 `globalState`。
- 不实现会话搜索/标签/导出：仅做列表浏览、重命名、删除三件事。
- 不修改 streaming 协议或 AI runner 行为。
- 不修改 `core` 包；`ProfileStore` 的 active profile 仍是全局唯一，会话只**记录**它发起请求时所用的 Profile ID 用于显示。
- 不为已有会话补做迁移：升级首次打开时旧的内存会话直接丢失（用户从未持久化过，无可迁移数据）。

## Decisions

### 1. 会话存储：`globalState` + 内存映射，懒加载

**选择**：在扩展 `globalState` 中以单个 key `ai.conversations` 存一个 `Conversation[]` 数组（最多保留 50 条，按 `updatedAt` 倒序截断）。运行时通过新建的 `ConversationStore` 类维护内存副本，写操作 debounce 200ms 后批量 flush。

**结构**：
```ts
interface Conversation {
  id: string;              // uuid
  title: string;           // 用户可编辑，默认取 topic 或首条 user 消息前 20 字
  topic: string;           // 关联题目标题，无则空串
  systemPrompt: string;
  messages: ChatMessage[]; // 现有结构不变
  profileId: string;       // 创建时活跃的 profile id，仅用于显示
  createdAt: number;
  updatedAt: number;
}
```

**为何不用 `workspaceState`**：用户期望跨工作区也能看到历史（不同题库目录）。

**为何不上 SQLite/文件**：当前数据量小（50 条 × ~50 KB 上限 ≈ 2.5 MB），`globalState` 足够；引入文件存储会增加路径管理、并发写、迁移等复杂度，不符合"最小化改动"原则。

**淘汰策略**：写入时若条数 > 50，按 `updatedAt` 升序丢弃最旧的，保证存储有界。

### 2. UI 布局：左侧抽屉 + composer 状态条

```
┌─────────────────────────────────────────┐
│ ☰ 标题（当前会话）         + 新建 ⚙ 设置 │ ← header（去掉 profile badge、保留清空键）
├──────┬──────────────────────────────────┤
│ 历史 │                                  │
│ ──   │   消息列表                       │
│ 会话1│                                  │
│ 会话2│                                  │
│ ...  │                                  │
│      │                                  │
│      ├──────────────────────────────────┤
│      │ ▼ Profile: gpt-4o  · 脱敏开      │ ← 状态条（新位置展示当前 Profile）
│      │ ┌──────────────────────────────┐ │
│      │ │ 输入框                ▶ 发送│ │ ← composer
│      │ └──────────────────────────────┘ │
└──────┴──────────────────────────────────┘
```

- 左侧抽屉：默认折叠（节省空间），点击 header 的 ☰ 按钮切换；折叠时 width=0，展开时 width=200px；通过 CSS transform 动画，状态保存到 webview localStorage（仅 UI 偏好，不入 globalState）。
- 状态条：位于 messages 与 composer 之间，包含 Profile 下拉、脱敏指示。Profile 下拉是 `<select>`，列表项来自 `services.profiles.list()`；选择后发 `setActiveProfile` 消息给 extension host，host 调用 `ProfileStore.setActive` 并广播 `state` 事件刷新所有打开的视图。
- 移除 header 的 `<span class="profile">`，但保留绿点指示色逻辑迁到状态条。

### 3. 会话切换语义

- 切换会话时：取消当前流式请求（`abortCtl.abort()`），从存储读取目标会话，重置 `streaming = ''`，重新渲染所有历史消息。
- 新建空对话时：生成新 id，标题默认 "新对话"，`systemPrompt` 沿用现有默认教练 prompt，`profileId = profiles.getActiveId()`，立即切换到该会话。
- "清空对话" 现仅作用于当前会话的 `messages`（保留会话条目本身），与"删除会话"区分。

### 4. Profile 切换的影响范围

底部切换 Profile **只影响下一次请求**：
- 不重写 `Conversation.profileId`（这个字段记录"会话创建时的 profile"，仅做溯源展示）。
- 下次发起 `runStream()` 时读取当前 `ProfileStore.getActive()`。
- 多个打开的 AI 面板（虽然单例只有一个）和设置面板通过现有 `AIPanel.refreshState` 同步标签显示。

替代方案讨论：**将 profile 绑定到会话**（每个会话固定一个 profile）—— 拒绝。理由：(a) 与 `ProfileStore` 全局 active 模型冲突，需要双轨制；(b) 用户的典型使用是"同一题问不同模型对比"，把 profile 绑定到会话会强制开新会话，反而增加操作。

### 5. 命令与 webview 协议扩展

新增 webview → host 消息：
- `{ kind: 'newConversation' }`
- `{ kind: 'switchConversation'; id: string }`
- `{ kind: 'renameConversation'; id: string; title: string }`
- `{ kind: 'deleteConversation'; id: string }`
- `{ kind: 'setActiveProfile'; id: string }`
- `{ kind: 'toggleDrawer' }` —— 仅前端 CSS 动作，无需发到 host（保留以便日后改埋点）。

新增 host → webview 消息：
- `init` 扩展为携带 `conversations: ConversationSummary[]`、`currentId: string`、`profiles: ProfileSummary[]`。
- `{ kind: 'conversationsUpdated'; conversations: ConversationSummary[]; currentId: string }`
- `{ kind: 'profilesUpdated'; profiles: ProfileSummary[]; activeId: string }`

`ConversationSummary` 只含 `{ id, title, topic, updatedAt }`，不含完整 `messages`，避免每次刷新都把所有消息推给前端。切换会话时单独推 `init` 重置消息列表。

新增命令 `ojAgent.ai.newConversation`：与按钮共用逻辑，便于命令面板/快捷键调用。

## Risks / Trade-offs

- **[globalState 体积膨胀]** → 用户大量使用后 globalState 可能数百 KB。Mitigation：硬上限 50 条 + 单消息 markdown 不做压缩但截断保存（保持现状）。后续可加"导出后清空"按钮，不在本次范围。
- **[并发写竞争]** → 流式过程中用户切换会话，新会话写 vs 旧会话 commitAssistant。Mitigation：每个流式任务在开始时记录其 `conversationId`，`commitAssistant` 把结果写到**该 id 对应**的会话而不是 `currentId`；用户切走后旧会话仍能正确收尾。
- **[Profile 列表过长时下拉拥挤]** → 用户可能有十几个 profile。Mitigation：`<select>` 原生即可处理，不做额外 UI；超过 20 个时考虑改 QuickPick（本次不实现，记入 Open Questions）。
- **[抽屉与窄面板冲突]** → AI 面板被拖窄到 ~300px 时抽屉占用过多。Mitigation：抽屉宽度固定 200px，面板 < 480px 时默认折叠且 ☰ 按钮显示 badge 提示有 N 条历史。
- **[向后兼容]** → 用户从旧版升级，旧的内存会话本就不持久化，丢失符合预期；只需保证首次启动时 `ai.conversations` 缺失不报错（默认空数组）。

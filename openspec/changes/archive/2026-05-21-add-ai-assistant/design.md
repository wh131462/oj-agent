## Context

OJ-Agent v0.1 PRD 聚焦"拉取/测试/提交"主流程，但学习侧（错因解释、解题思路、题解生成）缺位。AI 模型生态高度异构：用户可能持有 OpenAI、Anthropic 官方 Key，也可能使用 Azure OpenAI、DeepSeek、Moonshot、OpenRouter、Ollama OpenAI-compatible、Claude Code Gateway 等第三方 / 自托管端点。社区事实标准已收敛到两个协议族：**OpenAI Chat Completions** 与 **Anthropic Messages**。绝大多数第三方端点至少兼容其中一个。

### 当前约束
- VSCode 扩展 TypeScript 单体，已计划用 `SecretStorage` 管 OJ 凭证。
- 已规划 `core/http-client` 含限速 / 重试 / 代理。
- 题面 Webview 已规划使用 KaTeX 渲染，AI 面板可复用同一 Markdown 管线。

### 利益相关者
- 终端用户：希望"加个 Key 就能用"，且可在 OpenAI 系与 Claude 系之间切换。
- 维护者：希望不锁定某家 SDK 版本，便于跟进协议演进与第三方兼容。

## Goals / Non-Goals

**Goals:**
- 用单一抽象 `AIProvider` 接口同时支持 OpenAI 与 Anthropic 协议，运行时按 Profile 切换。
- 流式响应统一为内部 `AsyncIterable<AIChunk>`，UI 层不关心底层协议差异。
- API Key 与 OJ 凭证统一走 SecretStorage，命名空间隔离。
- AI 上下文构造与发送透明可控（预览/编辑/脱敏/截断）。
- 不引入任何官方 SDK 依赖（避免版本耦合 + 减小扩展体积）。

**Non-Goals:**
- 不做 Function Calling / Tool Use（首期纯文本对答即可覆盖需求）。
- 不做对话历史多轮持久化（每次动作是独立的单轮请求，UI 上可继续追问但不跨题持久化）。
- 不做本地小模型推理（仅做远程 HTTP）。
- 不做 token 精确计数（采用 `text.length / 4` 粗略估算即可，避免引入 tokenizer 依赖）。

## Decisions

### D1：双协议适配 vs 单协议+网关

- **选择**：在扩展内同时实现 OpenAI 与 Anthropic 两套适配器。
- **理由**：用户实际持有的 Key 形态分裂；强制走某一种协议（即便是 OpenAI 这种"最通用"）也会损失 Anthropic 原生用户的体验（如 prompt caching、cache_control header），且第三方网关引入额外故障域。
- **替代**：仅支持 OpenAI 协议、靠用户找网关把 Anthropic 转 OpenAI。否决——增加用户配置成本，且 prompt caching 等特性无法透传。

### D2：流式实现走原生 fetch + SSE 解析

- **选择**：用 Node 18+ 内置 `fetch` 的 `ReadableStream`，自行解析 `data:` SSE 行（OpenAI）与 `event:`/`data:` 事件对（Anthropic）。
- **理由**：避免依赖 `eventsource` 等第三方包；两种协议都是基于 SSE 的简单文本格式，自行解析约 80 行代码。
- **替代**：用官方 SDK。否决——`@anthropic-ai/sdk` + `openai` 双 SDK 增加约 2MB 体积，且更新节奏由它们控制。

### D3：Profile 作为一等公民 vs 全局单 Provider

- **选择**：用户可保存多个 Profile（含 OpenAI 一个 + Anthropic 一个 + 自托管一个），通过 `activeProfileId` 切换。
- **理由**：实际使用场景中，用户会按"日常题用便宜模型 / 难题用强模型"切换；强制全局单 Provider 会让用户频繁改配置。
- **替代**：仅允许一个全局 Provider。否决——降低实用性。

### D4：API Key 永不进 settings.json

- **选择**：所有 Key 仅入 SecretStorage，settings.json 的 Profile 对象不含 `apiKey` 字段。
- **理由**：settings.json 可能被同步到 GitHub Settings Sync、误提交到工作区 `.vscode/settings.json`、被同事截图泄漏。
- **替代**：允许用户选择"我接受不安全存储"。否决——为方便性牺牲安全是反模式，且 SecretStorage 已足够易用。

### D5：上下文截断策略

- **选择**：按优先级保留题面 > 失败用例摘要（仅首个失败） > 当前代码 > 其余样例。用 `text.length / 4` 估 tokens。
- **理由**：失败用例是错因解释最关键的信号；多个失败往往同源，首个最具代表性；样例可由 LLM 从题面推断。
- **替代**：保留所有失败用例。否决——容易爆上下文，多失败常是同质化的。

### D6：脱敏默认开 + 用户可关

- **选择**：默认脱敏 `username`、`submissionId`、`Cookie`、`Authorization` 等字段；用户可在设置关闭。
- **理由**：第三方端点不可信假设是合理默认；同时给"信任自托管端点"的用户留口子。

### D7：速率限制与 OJ 共器但独配额

- **选择**：复用 `http-client` 限速器组件，但 AI 与各 OJ 平台各持独立桶；默认 AI 20 req/min。
- **理由**：用户的 OJ 请求与 AI 请求互不干扰，但实现复用降低维护成本。

## Risks / Trade-offs

- **风险：第三方 OpenAI 兼容端点的 SSE 协议细节差异**（如 Azure 的 `data: [DONE]` 时机、某些网关不发送 keepalive 注释行）
  → **缓解**：解析器宽容设计——忽略空行与注释行；遇到非法 JSON chunk 跳过并记录 warning，不中断整流。

- **风险：Anthropic 协议演进（`anthropic-version` 升级）破坏请求格式**
  → **缓解**：将 `anthropic-version` 作为 Profile 的隐藏配置项暴露（默认 `2023-06-01`），允许用户在不升级扩展的情况下手动跟进。

- **风险：用户在 baseUrl 中误填带路径的 URL**（如 `https://api.example.com/v1`）
  → **缓解**：保存时自动剥离末尾的 `/v1` 或 `/v1/`，并在 UI 提示规范格式。

- **风险：API Key 误粘到 `model` 字段**
  → **缓解**：保存时正则检测 `sk-` / `xai-` / `claude-...` 前缀的字段错位，弹出确认。

- **风险：流式响应中断后底层连接未释放，泄漏 socket**
  → **缓解**：用 `AbortController` 严格管理；面板关闭时 dispose 中触发 abort。

- **风险：用户把脱敏关掉后忘记重新打开**
  → **缓解**：UI 状态栏在脱敏关闭时持续显示醒目"AI: 脱敏 OFF" 警示标签。

- **Trade-off：不引入 SDK = 维护 protocol 代码** vs **引入 SDK = 体积 / 锁版本**。已选前者，约 200 行实现成本可控。

## Migration Plan

不涉及破坏性变更，纯增量。无现有 AI 配置需要迁移。Rollback 方案：禁用 AI 命令注册即可（Profile 配置保留无影响）。

## Open Questions

- Q1：是否在首次安装时弹出 "添加 AI Profile" 引导？（暂定不弹，避免打扰，仅在用户点 AI 入口且无 Profile 时引导）
- Q2：是否需要支持本地 Ollama 的原生 `/api/chat` 协议？（暂定否——用户走 Ollama 的 OpenAI 兼容端点即可，规避新增第三套协议）

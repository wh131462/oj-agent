## 1. 基础脚手架与类型

- [x] 1.1 在 `src/core/ai/` 下新建模块目录，定义 `types.ts`：`AIProfile`、`AIProvider`（枚举 `openai|anthropic`）、`AIMessage`、`AIChunk`（含 `type: text|done|error` 与 payload）、`AIRequestOptions`。
- [x] 1.2 定义内部接口 `AIProviderAdapter`：`stream(messages, system, opts, signal): AsyncIterable<AIChunk>`。
- [x] 1.3 在 `package.json` `contributes.configuration` 中新增 `ojAgent.ai.profiles`（数组）、`ojAgent.ai.activeProfileId`（字符串）、`ojAgent.ai.rateLimit.perMinute`（默认 20）、`ojAgent.ai.privacy.redact`（默认 true）四项配置，且 schema 中明确 profile 对象不含 `apiKey`。

## 2. Provider 适配器实现

- [x] 2.1 实现 `OpenAIAdapter`：POST `{baseUrl||'https://api.openai.com'}/v1/chat/completions`，鉴权 `Authorization: Bearer`；流式解析 SSE `data:` 行，忽略空行与注释行，识别 `[DONE]` 结束符。
- [x] 2.2 实现 `AnthropicAdapter`：POST `{baseUrl||'https://api.anthropic.com'}/v1/messages`，鉴权 `x-api-key` + `anthropic-version: 2023-06-01`；解析 SSE 事件流，转换 `content_block_delta.delta.text` 为内部 `AIChunk`，处理 `message_stop`。
- [x] 2.3 实现 `createAdapter(profile)` 工厂：按 `provider` 字段返回对应 Adapter 实例，注入运行时 `fetch` 与 `AbortController`。
- [x] 2.4 编写单元测试：用 fixtures 模拟两种协议的 SSE 字节流，校验解析正确性、错误 chunk 跳过、abort 行为。

## 3. Profile 与 Key 管理

- [x] 3.1 实现 `ProfileStore`：读写 `workspace.getConfiguration('ojAgent.ai').profiles`，提供 add/update/remove/list/getActive；id 自动以 label kebab-case 生成并防冲突。
- [x] 3.2 实现 `ApiKeyVault`：包装 `SecretStorage`，键格式 `ai.apiKey.<profileId>`；提供 set/get/delete/has；与 OJ 凭证命名空间隔离的 assertion 测试。
- [x] 3.3 实现 baseUrl 规范化：保存时自动剥离末尾 `/v1`、`/v1/`、`/v1/chat/completions`、`/v1/messages` 等冗余路径。
- [x] 3.4 实现 Key 错位检测：保存 Profile 时若 `model` 或 `label` 字段匹配 `^sk-|^xai-|^claude-key-` 前缀则警示用户。

## 4. 上下文构造与脱敏

- [x] 4.1 实现 `ContextBuilder`：四种动作（explainError / generateApproach / generateSolution / explainCode）各一个上下文模板，输入为 `ProblemDetail` + `Code` + `FailedCase?`。
- [x] 4.2 实现 `Redactor`：剥离 `username`、`submissionId`、`Cookie`、`Authorization` 字段（递归遍历 + 关键字匹配）。
- [x] 4.3 实现 `tokenEstimate(text) = ceil(text.length / 4)` 与 `truncate(context, maxInputTokens)`：按优先级（题面 > 首个失败用例 > 当前代码 > 其余样例）截断，返回被省略部分摘要供 UI 展示。

## 5. 速率限制

- [x] 5.1 扩展 `core/http-client` 限速器，支持多桶（key: `ai` / `oj.<platform>`），AI 桶按 `ojAgent.ai.rateLimit.perMinute` 配置滑动窗口。
- [x] 5.2 在 AI 请求入口处接入限速器，超限时抛出可识别错误 `RateLimitError`，携带 `retryAfterSeconds`。

## 6. AI 面板 UI

- [x] 6.1 新建 Webview 视图 `ojAgent.aiPanel`，复用题面 Webview 的 Markdown + KaTeX 渲染管线（提取为共享模块 `ui/markdown-renderer`）。
- [x] 6.2 实现"提示词预览/编辑"区：默认折叠展示构造后的 prompt，用户可展开编辑后再发送；显示 token 估算与截断提示。
- [x] 6.3 实现流式渲染：消息 chunk 到达即追加到当前 assistant 气泡；提供"停止生成"按钮调用 abort。
- [x] 6.4 显示当前活动 Profile 名与脱敏状态徽章；脱敏 OFF 时徽章高亮警示。
- [x] 6.5 错误态：HTTP 4xx/5xx、网络错误、`RateLimitError` 分别给出文案，提供"重试"按钮。

## 7. 命令与入口集成

- [x] 7.1 注册命令 `ojAgent.ai.explainError`、`ojAgent.ai.generateApproach`、`ojAgent.ai.generateSolution`、`ojAgent.ai.explainCode`、`ojAgent.ai.switchProfile`、`ojAgent.ai.testConnection`，均不绑定默认快捷键。
- [x] 7.2 在题面 Webview 顶部工具栏添加四个 AI 按钮，并在未配置 Profile 时禁用 + 引导跳转。
- [x] 7.3 在本地测试结果面板的每个失败用例旁添加"解释错因"按钮，点击后触发 `explainError` 并自动带入该用例上下文。
- [x] 7.4 状态栏添加 `AI: <profile-label>` 项，点击触发 `switchProfile`；未配置时显示 `AI: 未配置`。

## 8. 设置面板

- [x] 8.1 在扩展设置中新增"AI 模型"分类，以自定义 Webview 形式（而非纯 settings.json）提供 Profile CRUD：新建 / 编辑 / 删除 / 设为活动 / 测试连接 / 清除 Key。
- [x] 8.2 API Key 输入框使用 `password` 类型，已存在时显示 `sk-****abcd` 掩码，不可复制；点击"更换"才允许重新输入。
- [x] 8.3 实现"测试连接"：发起 max_tokens=1 的最小流式请求，UI 展示 HTTP 状态码、耗时、是否收到至少 1 个 chunk。
- [x] 8.4 提供常用预设：OpenAI（gpt-4o, gpt-4o-mini）、Anthropic（claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5-20251001）、DeepSeek、OpenRouter 的 baseUrl 模板，点击即填充。

## 9. 文档与发布

- [x] 9.1 在 `docs/PRD.md` 追加 §4.6 AI 助手章节（仅指向 spec，避免重复维护）。
- [x] 9.2 在 `README.md` 增加 "AI 助手" 段落，说明如何添加 Profile、切换 Provider、隐私边界。
- [x] 9.3 集成测试：mock OpenAI 与 Anthropic SSE 端点，端到端跑通"题面 → 触发 explainError → 流式渲染 → 中断"。
- [x] 9.4 安全审计自检：grep `apiKey` 确保未出现在 settings 序列化路径；脱敏单测覆盖 `Cookie` / `Authorization` / `username`。

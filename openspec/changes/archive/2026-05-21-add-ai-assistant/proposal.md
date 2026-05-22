## Why

PRD v0.1 覆盖了"拉取 → 测试 → 提交"主流程，但**学习与解题辅助**这一关键体验空缺：用户在 WA/TLE/CE 时仍需离开 VSCode 去查题解、问 AI。同时 PRD 在 AI 接入、遥测、错误上报、文档化键盘绑定与命令面板入口等方面也未明确。

本次变更引入 **AI 解题助手** 能力：用户在插件内配置任意 OpenAI 或 Anthropic 兼容格式的 API Key（含自托管/中转代理）即可获得"解题思路、题解生成、错题解释、代码 Review"等 AI 辅助，闭合多 OJ 学习流程的最后一公里。同时为该能力配套必要的设置项与命令入口骨架。

## What Changes

- 新增 **AI 助手** 能力：题面页与结果面板内提供"解释错因 / 生成思路 / 给出题解 / 解释代码"四类操作。
- 新增 **多 Provider 模型配置**：支持运行时切换 `openai` 与 `anthropic` 两种 API 协议格式；同一 Provider 下可配置多个 Profile（Base URL / API Key / 模型 ID / 温度 / 最大输出 tokens），允许接入 OpenAI、Anthropic 官方端点，也兼容任意 OpenAI/Anthropic 兼容的中转或自托管端点（如 Azure OpenAI、DeepSeek、OpenRouter、Ollama 的 OpenAI 兼容模式、Claude Code Gateway 等）。
- **API Key 安全存储**：所有 API Key 走 VSCode `SecretStorage`，与 OJ 凭证统一治理；设置面板仅显示掩码。
- **流式输出**：AI 回答以流式（SSE / Anthropic streaming events）逐字渲染到 Webview，可中断。
- **请求上下文构造**：解题动作自动将题面、样例、当前代码、本地测试失败的用例与 diff 作为上下文打包送入，由用户在发送前可预览/编辑提示词。
- **隐私与可见性**：默认仅将必要字段送给模型；提供"脱敏模式"（剥离 OJ 用户名、提交 ID）。明示"内容会发送至用户配置的第三方端点"。
- **配额与限速**：AI 请求与 OJ 请求共用 [[http-client]] 的限速器；可配置每分钟最大请求数与单次最大上下文 tokens（粗略估算 + 截断）。
- **命令面板入口**：新增 `OJ-Agent: AI · 解释错因`、`OJ-Agent: AI · 生成思路`、`OJ-Agent: AI · 解释代码`、`OJ-Agent: 切换 AI 模型 Profile` 等命令。
- PRD 补遗（随本次一并落地的最小范围）：
  - 明确 **遥测/隐私边界**：插件本身不上报任何匿名遥测；AI 调用仅发送至用户自配端点。
  - 明确 **AI 触发入口与默认快捷键留空**（避免与用户键位冲突，由用户在 keybindings 中绑定）。

## Capabilities

### New Capabilities
- `ai-assistant`: AI 解题与解释能力（解释错因、生成思路/题解、代码解释、流式输出、上下文打包）。
- `model-provider`: 多 Provider 模型配置、Profile 切换、OpenAI/Anthropic 双协议适配、API Key 安全存储。

### Modified Capabilities
<!-- 当前仓库尚无已落地的 spec（openspec/specs/ 为空），无 modified capabilities。 -->

## Impact

- **新增代码**：`core/ai/`（provider 适配器、上下文构造器、流式解析器）、`ui/ai-panel`（聊天/解释面板，可与题面 Webview 复用渲染管线，含 Markdown + KaTeX + 代码块复制）。
- **配置项扩展**：`ojAgent.ai.activeProfile`、`ojAgent.ai.profiles[]`（含 `provider`、`baseUrl`、`model`、`temperature`、`maxOutputTokens`、`requestTimeoutMs`）、`ojAgent.ai.rateLimit`、`ojAgent.ai.privacy.redact`。
- **SecretStorage 键扩展**：`ai.apiKey.<profileId>`。
- **依赖**：复用现有 fetch / http-client，无需引入官方 SDK（直接用 HTTP + 流解析，避免锁定 SDK 版本，便于兼容第三方端点）。
- **对现有平台适配器无破坏**：新增能力，PlatformAdapter 接口不变。
- **文档**：PRD 后续可追加 §4.6 AI 助手章节，本次以 spec 为主，PRD 不在本变更范围内强行修改。

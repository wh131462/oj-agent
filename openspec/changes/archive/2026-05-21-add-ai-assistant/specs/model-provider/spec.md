## ADDED Requirements

### Requirement: Profile 数据模型

系统 SHALL 以 **Profile**（配置档）为单位管理 AI 模型连接。每个 Profile MUST 包含以下字段：`id`（唯一标识，kebab-case）、`label`（用户可读名称）、`provider`（枚举：`openai` | `anthropic`）、`baseUrl`（可选，缺省时使用 Provider 官方端点）、`model`（模型 ID 字符串）、`temperature`（数值，0–2，默认 0.2）、`maxOutputTokens`（数值，默认 2048）、`maxInputTokens`（数值，默认 32000）、`requestTimeoutMs`（数值，默认 60000）、`extraHeaders`（可选键值对，用于自定义鉴权头）。

#### Scenario: 创建 OpenAI Profile

- **WHEN** 用户在设置面板填写 label="OpenAI GPT-4o"、provider="openai"、model="gpt-4o" 并保存
- **THEN** 系统生成 id="openai-gpt-4o"（kebab-case），将 Profile 写入 `ojAgent.ai.profiles`，API Key 写入 `SecretStorage` 键 `ai.apiKey.openai-gpt-4o`

#### Scenario: 创建第三方 Anthropic 兼容端点

- **WHEN** 用户填写 provider="anthropic"、baseUrl="https://api.example.com"、model="claude-sonnet-4-6"
- **THEN** 系统保存该 Profile，调用时 HTTP 请求发往 `https://api.example.com/v1/messages`，鉴权头采用 Anthropic 协议（`x-api-key` + `anthropic-version`）

### Requirement: Provider 协议适配

系统 SHALL 同时支持 **OpenAI Chat Completions** 与 **Anthropic Messages** 两种协议。Profile 的 `provider` 字段决定请求构造、鉴权头、响应解析与流式事件处理策略。

#### Scenario: OpenAI 协议请求

- **WHEN** 用户使用 provider="openai" 的 Profile 发起请求
- **THEN** 系统向 `{baseUrl}/v1/chat/completions` POST 请求，鉴权使用 `Authorization: Bearer {apiKey}`，请求体为 `{model, messages, temperature, max_tokens, stream: true}`，流式解析 `data:` SSE 行中的 `choices[0].delta.content`

#### Scenario: Anthropic 协议请求

- **WHEN** 用户使用 provider="anthropic" 的 Profile 发起请求
- **THEN** 系统向 `{baseUrl}/v1/messages` POST 请求，鉴权使用 `x-api-key: {apiKey}` + `anthropic-version: 2023-06-01`，请求体为 `{model, messages, system, temperature, max_tokens, stream: true}`，流式解析 SSE 中 `content_block_delta` 事件的 `delta.text`

### Requirement: 活动 Profile 切换

系统 SHALL 维护一个 `activeProfileId` 表示当前生效的 Profile。用户 SHALL 能通过命令 `OJ-Agent: 切换 AI 模型 Profile` 在所有已配置 Profile 之间快速切换，状态栏 SHALL 展示当前活动 Profile 的 `label`。

#### Scenario: 切换 Profile

- **WHEN** 用户从命令面板选择 "OJ-Agent: 切换 AI 模型 Profile" 并选中 "Anthropic Claude"
- **THEN** `activeProfileId` 更新为该 Profile 的 id，状态栏显示 "AI: Anthropic Claude"，之后的 AI 请求使用该 Profile

#### Scenario: 删除当前活动 Profile

- **WHEN** 用户删除当前 `activeProfileId` 所指向的 Profile
- **THEN** 系统将 `activeProfileId` 置为剩余 Profile 中的第一个；若已无 Profile，则置为空，状态栏显示 "AI: 未配置"

### Requirement: API Key 安全存储

系统 MUST 将所有 API Key 存入 VSCode `SecretStorage`，严禁写入 `settings.json` 或工作区文件。设置面板上 API Key 输入框 SHALL 仅显示遮罩（例如 `sk-****...****abcd`，仅保留末 4 位），且不允许复制。

#### Scenario: API Key 不进入配置文件

- **WHEN** 用户保存任意 Profile
- **THEN** `ojAgent.ai.profiles` 配置项中该 Profile 对象不包含 `apiKey` 字段，对应 Key 仅存在于 SecretStorage

#### Scenario: 卸载或重置 Key

- **WHEN** 用户在设置面板点击某 Profile 的"清除 API Key"
- **THEN** SecretStorage 键 `ai.apiKey.<profileId>` 被删除，该 Profile 标记为"未配置 Key"，相关 AI 入口对该 Profile 禁用

### Requirement: 连通性测试

系统 SHALL 在 Profile 保存后提供"测试连接"按钮，发起最小可用请求（OpenAI: `messages=[{role:user,content:"ping"}], max_tokens=1`；Anthropic 同义），并在 UI 上明示 HTTP 状态码、响应耗时与是否流式正常。

#### Scenario: 测试连接成功

- **WHEN** 用户点击"测试连接"，端点返回 200 且产生至少 1 个流式 chunk
- **THEN** UI 显示 "连接成功（耗时 N ms，流式正常）"

#### Scenario: 鉴权失败

- **WHEN** 端点返回 401
- **THEN** UI 显示 "鉴权失败（HTTP 401），请检查 API Key"，不再继续请求

### Requirement: 与 OJ 凭证隔离

系统 SHALL 在 SecretStorage 中以 `ai.apiKey.<profileId>` 命名 AI Key，与 OJ 凭证键命名空间 `oj.cred.<platformId>` 严格隔离；任一类凭证泄漏 MUST NOT 影响另一类。

#### Scenario: 命名空间隔离

- **WHEN** 开发者读取 SecretStorage 所有键
- **THEN** AI Key 键全部以 `ai.apiKey.` 开头，OJ 凭证全部以 `oj.cred.` 开头，无交叉

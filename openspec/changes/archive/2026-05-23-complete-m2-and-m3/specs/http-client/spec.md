## ADDED Requirements

### Requirement: 平台会话注入 withSession

`HttpClient` SHALL 提供 `withSession(platformId)` 工具,在请求中自动注入登录 Cookie 与浏览器化请求头(`User-Agent`、`Accept-Language`、`Referer`),供 Codeforces / 洛谷等需要绕过 Cloudflare/易盾的平台使用。

#### Scenario: 注入完整会话上下文
- **WHEN** Codeforces 适配器调用 `httpClient.request(req, withSession('codeforces'))`
- **THEN** 实际出网请求头含 Cookie、浏览器化 `User-Agent` 与 `Referer: https://codeforces.com/`

#### Scenario: 检测到 Cloudflare 拦截响应
- **WHEN** 响应 HTML 含 `cf-turnstile` / 易盾标记,且本次请求使用 `withSession`
- **THEN** `HttpClient` 抛 `AdapterError` 且 `code === 'AUTH_REQUIRED'`,提示用户在浏览器完成验证

### Requirement: 平台级超时与重试配置表

`HttpClient` SHALL 维护按 `platformId` 索引的默认超时/重试配置表;POJ 默认超时 30000ms 且 GET 默认重试 1 次,其他平台沿用全局默认 15000ms。配置 MUST 与现有限速器配置同源。

#### Scenario: POJ 使用更宽松的超时
- **WHEN** POJ 适配器通过 `withSession('poj')` 发起 GET
- **THEN** 默认 `timeoutMs=30000`;首次超时后自动重试 1 次

#### Scenario: 其他平台沿用默认
- **WHEN** LeetCode CN 适配器发起 GET 且未显式覆盖
- **THEN** `timeoutMs=15000`,GET 重试次数遵循既有默认

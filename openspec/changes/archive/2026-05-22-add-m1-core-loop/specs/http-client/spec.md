## ADDED Requirements

### Requirement: 统一请求接口

系统 SHALL 提供 `HttpClient.request(options)`，`options` MUST 包含 `{ url, method, headers?, body?, query?, responseEncoding?, formEncoding?, responseType?, signal?, timeoutMs?, retry?, platformId? }`。`HttpClient` MUST 内部使用 Node 18+ 全局 `fetch`，不引入 `axios`。所有适配器 MUST 通过 `HttpClient` 发起请求，不允许直接调用 `fetch`。

#### Scenario: JSON 请求

- **WHEN** 适配器以 `request({ url, method:'POST', body:{...}, headers:{'Content-Type':'application/json'} })` 发请求
- **THEN** HttpClient 序列化 body 为 JSON、发送请求、自动解析 JSON 响应并返回 `{ status, headers, data }`

### Requirement: 限速

`HttpClient` MUST 按 `platformId` 维护独立的 token-bucket。默认速率 60 req/min，可由 `ojAgent.http.<platform>.rateLimit` 覆盖。当令牌不足 MUST 等待补充，不直接拒绝。`AbortSignal` MUST 能取消正在等待的请求。

#### Scenario: 平台限速独立

- **WHEN** LeetCode CN 与 HDOJ 同时各自发起 100 个请求
- **THEN** 两个平台限速队列互不影响，分别按各自速率消费

### Requirement: 编码转换

当 `responseEncoding='gbk'` 时，HttpClient MUST 以二进制读取响应并通过 `iconv-lite` 解码为 UTF-8 字符串。当 `formEncoding='gbk'` 且 body 为 `Record<string,string>` 时，HttpClient MUST 将每个键值 GBK 编码后拼接为 `application/x-www-form-urlencoded` 字节。

#### Scenario: 提交 HDOJ GBK 表单

- **WHEN** 调用 `request({ method:'POST', body:{ usercode:'中文代码' }, formEncoding:'gbk', headers:{'Content-Type':'application/x-www-form-urlencoded'} })`
- **THEN** 请求体的「中文代码」三字 SHALL 以 GBK 字节出现在 HTTP body 中

### Requirement: Cookie 注入

当 `platformId` 指定且 `CredentialStore` 有该平台凭证，HttpClient MUST 自动添加 `Cookie` 头（合并适配器传入的 `headers.Cookie`，去重）。`Set-Cookie` 响应头 MUST 回写至 `CredentialStore.update(platformId, ...)`，并保留 HttpOnly/Path 等属性的弱解析。

#### Scenario: 自动携带 Cookie

- **WHEN** `platformId='leetcode-cn'`，凭证含 `LEETCODE_SESSION=xxx`
- **THEN** 请求头 `Cookie` SHALL 包含 `LEETCODE_SESSION=xxx`

### Requirement: 超时与重试

`timeoutMs` 默认 30000；超时 MUST 抛 `AdapterError { code:'TIMEOUT', retriable:true }`。`retry` 默认 `{ maxAttempts:2, backoff:'exponential', baseMs:500 }`，仅对幂等方法（GET / HEAD / 只读 GraphQL query）启用，POST 默认不重试。

#### Scenario: GET 超时重试

- **WHEN** GET 请求第一次超时
- **THEN** HttpClient 等待 500ms 后重试，最多 2 次，最终仍失败抛 `TIMEOUT`

#### Scenario: POST 不自动重试

- **WHEN** POST 提交超时
- **THEN** 立即抛 `TIMEOUT`，不重试，避免重复提交

### Requirement: 代理透传

`HttpClient` MUST 读取 VSCode 配置 `http.proxy`，若已设置则通过 `undici.ProxyAgent` 转发，无需在 OJ-Agent 自行配置。

#### Scenario: VSCode 已配置代理

- **WHEN** 用户设置 `http.proxy=http://127.0.0.1:7890`
- **THEN** HttpClient 所有出站请求经此代理

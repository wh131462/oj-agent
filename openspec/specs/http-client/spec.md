# http-client Specification

## Purpose

定义 `@oj-agent/core` 中统一出网组件 `HttpClient` 的行为规范,封装所有平台适配器的网络请求,集成限速、超时、重试、Cookie 注入、GBK 编码、代理与 `AdapterError` 归一化。

## Requirements

### Requirement: HttpClient 统一出网

`@oj-agent/core` SHALL 提供唯一的 `HttpClient` 类,封装所有出网请求。所有平台适配器 MUST 通过 `HttpClient` 发起请求,MUST NOT 直接调用 `fetch / undici / axios`。

#### Scenario: 适配器只能通过 HttpClient 出网
- **WHEN** 代码评审 grep 检查 `packages/core/src/platform/**/*.ts` 中的 `fetch(`、`new Request(`、`http.request`、`axios`、`got`
- **THEN** 不存在任何匹配项;所有出网调用均经 `httpClient.request(...)`

#### Scenario: HttpClient 接受标准化请求对象
- **WHEN** 调用方传入 `{ url, method, headers, query, body, contentType, formEncoding, responseEncoding, timeoutMs, retry, injectCookieFor, signal }`
- **THEN** `HttpClient.request` 返回 `HttpResponse { status, headers, text, json<T>() }`,`text` 已按 `responseEncoding` 解码

### Requirement: 限速集成

`HttpClient` SHALL 在出网前按 `platformId`(由 `injectCookieFor` 或显式 `rateLimitKey` 字段确定)调用 `RateLimiter.tryConsume(bucket)`;桶满 MUST 立即抛 `AdapterError('RATE_LIMITED', ..., retriable=true)`,MUST NOT 阻塞等待。不同 `platformId` MUST 互不影响。

#### Scenario: 单平台限速触发
- **WHEN** 平台 QPS 限制为 4,在 60 秒窗口内已消耗 4 次,第 5 次发起请求
- **THEN** `HttpClient` 抛 `AdapterError('RATE_LIMITED')`,不出网

#### Scenario: 跨平台不互相阻塞
- **WHEN** `leetcode-cn` 桶已满,同时向 `hdoj` 发起 1 个请求
- **THEN** `hdoj` 请求正常出网,不受 `leetcode-cn` 桶影响

#### Scenario: rateLimitKey 为空时不限速
- **WHEN** 请求未设 `injectCookieFor` 也未显式 `rateLimitKey`
- **THEN** 跳过限速器调用,直接出网

### Requirement: 超时与中止

`HttpClient` SHALL 对每个请求应用 `timeoutMs`(默认 15000ms),超时 MUST 抛 `AdapterError('NETWORK_ERROR', ..., retriable=true)`。调用方传入 `AbortSignal` 时 MUST 在 abort 触发后立即中止请求(包括限速等待阶段)。

#### Scenario: 超时
- **WHEN** 远端 16s 不响应,`timeoutMs=15000`
- **THEN** 在 ~15s 后抛出 `AdapterError`,`code='NETWORK_ERROR'`,`retriable=true`

#### Scenario: 外部 abort
- **WHEN** 调用方在请求出网前 `abortController.abort()`
- **THEN** `HttpClient.request` 立即 reject,不消耗限速配额

### Requirement: 幂等重试

`HttpClient` SHALL 仅对 `GET / HEAD` 请求启用默认重试(2 次,指数退避 baseDelay=500ms × 2^n + 0-200ms jitter);`POST / PUT / DELETE / PATCH` 默认 MUST NOT 重试。`5xx` 与 `NETWORK_ERROR` 之外的错误 MUST NOT 触发重试。

#### Scenario: GET 5xx 自动重试
- **WHEN** 上游对 GET 连续返回 500、500、200
- **THEN** `HttpClient` 最终返回 200,内部经历 2 次重试

#### Scenario: POST 不重试
- **WHEN** 上游对 POST 返回 500
- **THEN** 立即抛 `AdapterError('PLATFORM_ERROR' | 'NETWORK_ERROR', ..., retriable=true)`,不重试

#### Scenario: 4xx 不重试
- **WHEN** GET 返回 401
- **THEN** 立即抛 `AdapterError('AUTH_REQUIRED', ..., retriable=false)`,不重试

### Requirement: Cookie 注入

当请求设置 `injectCookieFor: PlatformId` 时,`HttpClient` SHALL 在发起前从 `CredentialStore.get(platform)` 读取凭证,把 `cookie` 字段拼到 `headers.Cookie`;若凭证不存在 MUST 透传请求(不抛错,由适配器层决定是否拒绝)。

#### Scenario: 已登录注入 Cookie
- **WHEN** `credentialStore` 中存在 `oj.cookie.leetcode-cn = { cookie: "LEETCODE_SESSION=abc; csrftoken=xyz" }`,请求设 `injectCookieFor: 'leetcode-cn'`
- **THEN** 出网请求头 `Cookie: LEETCODE_SESSION=abc; csrftoken=xyz`

#### Scenario: 未登录透传
- **WHEN** 凭证不存在,请求设 `injectCookieFor: 'leetcode-cn'`
- **THEN** 出网请求不带 `Cookie` 头,不抛异常

### Requirement: GBK 编码支持

`HttpClient` SHALL 通过 `iconv-lite` 支持 `responseEncoding: 'gbk'`(响应字节流解码为 UTF-16 字符串)与 `formEncoding: 'gbk'`(`application/x-www-form-urlencoded` body 中每个值先 GBK 编码再 URL-encode)。默认编码 MUST 为 UTF-8。

#### Scenario: GBK 响应解码
- **WHEN** 远端返回 GBK 字节序列 `b'\xb2\xe2\xca\xd4'` (即「测试」),请求设 `responseEncoding: 'gbk'`
- **THEN** `response.text === '测试'`

#### Scenario: GBK 表单提交
- **WHEN** 提交 form `{ usercode: "int main() { /* 中文注释 */ }" }`,设 `formEncoding: 'gbk'`、`contentType: 'form'`
- **THEN** 出网 body 中"中文注释"字节为 GBK 序列,`Content-Type` 头为 `application/x-www-form-urlencoded; charset=gbk`

### Requirement: 代理透传

`HttpClient` 构造选项 SHALL 接受 `proxyUrl?: string`;非空时 MUST 通过 `undici.ProxyAgent` 转发所有请求。空时 MUST 直连。

#### Scenario: 配置代理
- **WHEN** `new HttpClient({ proxyUrl: 'http://127.0.0.1:7890' })` 发起请求
- **THEN** 出网 socket 连接到 127.0.0.1:7890,目标域名通过 `CONNECT` 隧道

### Requirement: AdapterError 归一化

`HttpClient` 对 HTTP 状态码与底层异常 SHALL 按下表归一化为 `AdapterError`:

| 触发条件 | code | retriable |
|---|---|---|
| `ETIMEDOUT / ECONNRESET / ENOTFOUND / 网络层` | `NETWORK_ERROR` | true |
| 401 | `AUTH_REQUIRED` | false |
| 403 | `AUTH_REQUIRED` | false |
| 404 | `NOT_FOUND` | false |
| 429 | `RATE_LIMITED` | true |
| 5xx | `PLATFORM_ERROR` | true |
| 解码失败 / 编码非法 | `PARSE_ERROR` | false |

#### Scenario: 429 标记可重试
- **WHEN** 远端返回 429
- **THEN** 抛 `AdapterError('RATE_LIMITED', ..., retriable=true)`,但 `HttpClient` 自身 MUST NOT 自动重试(交给上层 / 退避策略)

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

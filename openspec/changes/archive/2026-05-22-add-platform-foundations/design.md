## Context

`add-monorepo-layout` 完成了三包分层与代码迁移,`@oj-agent/core` 已有 `ai/*`、`http/rate-limiter.ts`、`platform/adapter.ts`(类型契约) 但没有任何具体平台实现。`add-m1-core-loop`(已 SUPERSEDED) 原方案中的 `http-client / auth-manager / leetcode-cn-adapter / hdoj-adapter` 都按 VSCode 内实现规划,需要重新搬到 `@oj-agent/core` 里去,以便 CLI 与 VSCode 共用。

约束:
- `@oj-agent/core` 必须保持零 VSCode 依赖(`add-monorepo-layout` 6.6 验证项已固化)。
- 凭证后端通过 core 已定义的 `SecretBackend` 接口注入,具体实现由前端负责(VSCode `SecretStorage` / CLI `keytar`)。
- 不允许引入需要原生编译的依赖;`iconv-lite` 与 `cheerio` 均为纯 JS。
- 必须沿用现有 `RateLimiter`(在 `packages/core/src/http/rate-limiter.ts`),不重复造轮。
- LeetCode CN 走 GraphQL;HDOJ 走 HTML 爬取 + GBK 表单提交。
- 错误归一化为 `AdapterError { code, message, retriable, source }`,`code` 取受限枚举。

干系人:`add-judge-and-workspace` / `add-cli-m1-commands` / `add-vscode-m1-views` 等下游 change 的实现者。

## Goals / Non-Goals

**Goals:**
- 在 `@oj-agent/core` 内交付可被 CLI 与 VSCode 直接调用的 `HttpClient / CredentialStore / PlatformAdapterRegistry`,以及 `leetcode-cn` 与 `hdoj` 两个具体适配器。
- 让上层(后续 change)调用 `registry.get('leetcode-cn').getProblem(id)` 即可拿到归一化的 `PlatformProblemDetail`,无需关心 Cookie / GBK / CSRF / 限速。
- 凭证存储路径与 AI Key 严格隔离;CredentialStore 失效检测与重登提示由 core 暴露事件,前端订阅。
- 测试全部在 mock fetch 下完成,不发任何真实网络请求。

**Non-Goals:**
- 不实现登录入口的 UI(VSCode Webview / CLI 粘贴流程)——这些由 `add-cli-m1-commands` / `add-vscode-m1-views` 负责,本变更只提供 core 侧的 `CredentialStore.set` 接口��
- 不实现 Codeforces / 洛谷 / POJ / 蓝桥 的适配器(M2/M3)。
- 不实现 judge / workspace / submission 编排(在 `add-judge-and-workspace`)。
- 不实现 CLI / VSCode 端的命令、视图、状态栏。
- 不实现 `SecretBackend` 的 keytar / SecretStorage 具体绑定(由各前端的 M1 change 负责)。
- 不绕过 Cloudflare / 易盾(M1 不涉及 Codeforces/洛谷)。

## Decisions

### D1:HttpClient 形态

封装 `HttpClient`,内部组合既有 `RateLimiter` 实例。接口:

```ts
interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: string | Record<string, unknown>;   // 对象时按 contentType 序列化
  contentType?: 'json' | 'form' | 'raw';
  formEncoding?: 'utf-8' | 'gbk';            // 默认 utf-8;HDOJ 提交用 gbk
  responseEncoding?: 'utf-8' | 'gbk';        // 默认 utf-8;HDOJ 响应用 gbk
  timeoutMs?: number;                        // 默认 15000
  retry?: { attempts: number; baseDelayMs: number }; // 仅 GET/HEAD 默认 2 次
  injectCookieFor?: PlatformId;              // 自动从 CredentialStore 读取注入
  signal?: AbortSignal;
}
interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;        // 已按 responseEncoding 解码
  json<T = unknown>(): T;
}
```

- 底层使用 Node ≥ 20 内置 `fetch`(undici),不引入 `axios`。
- POST 默认关闭重试;5xx + GET/HEAD 才指数退避(`baseDelayMs * 2^n` + jitter)。
- `injectCookieFor` 触发时:`headers.Cookie = await credentialStore.get(platform).cookie`;若不存在则不注入(由调用方决定是否拒绝)。
- 限速:复用既有 `RateLimiter.tryConsume(bucket)`(同步检查),桶满立即抛 `AdapterError('RATE_LIMITED')`,不阻塞。`bucket` key 由 `injectCookieFor || rateLimitKey` 决定;两者都缺省则跳过限速。
- `formEncoding='gbk'`:对每个 KV `iconv-lite.encode(v, 'gbk')` 后 URL-encode,拼接为 `application/x-www-form-urlencoded; charset=gbk`。
- `http.proxy` 透传:VSCode 端构造时传入 `proxyUrl?: string`;不存在则不走代理。

**备选**:直接用 `axios` → 体积大,且 `add-monorepo-layout` 已确认沿用内置 fetch。

### D2:CredentialStore 与 SecretBackend

`@oj-agent/core` 已有 `SecretBackend`(给 AI 用)。新增:

```ts
interface CredentialStore {
  get(platform: PlatformId): Promise<PlatformCredential | undefined>;
  set(platform: PlatformId, cred: PlatformCredential): Promise<void>;
  delete(platform: PlatformId): Promise<void>;
  onChange(listener: (platform: PlatformId) => void): Disposable;
}
class SecretCredentialStore implements CredentialStore {
  constructor(private backend: SecretBackend) {}
  // 键名: `oj.cookie.<platform>`,值为 JSON 序列化的 PlatformCredential
}
```

- 命名空间 `oj.cookie.*` 与 AI 的 `ai.apiKey.*` 在同一个 `SecretBackend` 实例下并存,前缀不冲突即可隔离。
- `onChange` 由 `set/delete` 内部触发;前端可在 UI 订阅。
- 不在 core 实现"登录"流程,只暴露 `set`;失效探活由 `CredentialChecker.check(platform)` 提供,内部用 `getProblem('1')` 等只读调用试探。

**备选**:让每个适配器自己拿 cookie → 否决,会重复 secret 读写、难以集中失效检测。

### D3:LeetCode CN 适配器细节

- 端点:`https://leetcode.cn/graphql/`(注意末尾斜杠),所有请求需要 `Content-Type: application/json`、`Referer: https://leetcode.cn/`、`Origin: https://leetcode.cn`。
- 写操作(`submit`)需要 `X-CSRFToken: <csrftoken cookie value>`。
- Query:`problemsetQuestionList`(列表)、`questionData`(详情,字段含 `translatedContent`、`exampleTestcases`、`codeSnippets`、`metaData`、`questionId`)。
- 提交:`POST https://leetcode.cn/problems/<slug>/submit/`,body `{ lang, question_id, typed_code }`。
- 轮询:`GET https://leetcode.cn/submissions/detail/<id>/check/`,`state` ∈ `PENDING/STARTED/SUCCESS`;`SUCCESS` 后看 `status_msg` 映射 verdict。
- 退避序列 `[1000, 2000, 3000, 5000, 5000, 5000, ...]`,总超时 60s。
- HTML 转 Markdown:`translatedContent` 是 HTML,用 `cheerio` 转(段落、`<pre>` 保留为 fenced code、`<sup>/<sub>` 转 KaTeX)。`exampleTestcases` 是换行分隔字符串,按 `metaData.params.length` 切分。
- 语言映射(M1):`cpp/python3/java/javascript` ↔ LeetCode `lang slug`。未映射抛 `AdapterError('LANG_UNSUPPORTED')`。

### D4:HDOJ 适配器细节

- 端点:`http://acm.hdu.edu.cn/`(HTTP,无 HTTPS)。
- 列表:`listproblem.php?vol=<n>`(每页 100),用 `cheerio` 抽取 `<tr>`;难度由通过率推断(<10% Hard,10-30% Medium,>30% Easy)。
- 详情:`showproblem.php?pid=<id>`,按"Problem Description / Input / Output / Sample Input / Sample Output / Hint"段抽取;Sample 两两配对。
- 编码:整站 GBK;响应必须 `responseEncoding='gbk'`,提交必须 `formEncoding='gbk'`。
- 登录:`POST http://acm.hdu.edu.cn/userloginex.php?action=login`,form `{ username, userpass, login: 'Sign In' }`;成功后 `Set-Cookie: PHPSESSID=...`(非 HttpOnly,前端 Webview 可读)。
- 提交:`POST http://acm.hdu.edu.cn/submit.php?action=submit`,GBK form `{ problemid, language, usercode, check: '0' }`,需带 `PHPSESSID` Cookie 与 `Referer: http://acm.hdu.edu.cn/submit.php?pid=<id>`。
- 轮询:`status.php?user=<username>&pid=<id>&first=&noprivate=1`,抓首行 `<tr>` 的状态文字(Accepted / Wrong Answer / Compile Error / ...)与 runID;同样 60s 超时,1s→2s→3s→5s 退避。
- 语言 ID 表(M1 静态):G++=1、GCC=2、C++=0、C=3、Pascal=4、Java=5、C#=6、Python=11、Bash=8(以平台当前为准,实现时再二次校对)。未支持抛 `LANG_UNSUPPORTED`。

### D5:错误归一化

```ts
type AdapterErrorCode =
  | 'NETWORK_ERROR'    // 超时 / DNS / TLS 失败
  | 'AUTH_REQUIRED'    // 401/403 或 LeetCode CN userStatus.isSignedIn=false
  | 'AUTH_EXPIRED'     // cookie 过期(原 200 但响应包含登录跳转标志)
  | 'RATE_LIMITED'     // 429 或平台返回风控页
  | 'PARSE_ERROR'      // HTML/JSON 结构变动
  | 'PLATFORM_ERROR'   // 平台返回 5xx 或业务错(如 LeetCode "Unknown error")
  | 'LANG_UNSUPPORTED' // 语言映射缺失
  | 'NOT_FOUND'        // 404 / 题号无效
  | 'JUDGING_TIMEOUT'; // 轮询超过总超时

class AdapterError extends Error {
  constructor(public code: AdapterErrorCode, message: string,
              public retriable: boolean, public source?: unknown) { super(message); }
}
```

UI/CLI 只需对 `code` 做分支,不关心底层细节。

### D6:Registry 与依赖注入

```ts
class PlatformAdapterRegistry {
  constructor(deps: {
    httpClient: HttpClient;
    credentialStore: CredentialStore;
    rateLimiter: RateLimiter;
  }) {}
  get(id: PlatformId): PlatformAdapter;  // 缺省 lazy create + 缓存
}
```

- 适配器实例化时把 `HttpClient` 绑定到自家 baseUrl / 限速桶。
- 同一进程内 `registry.get('leetcode-cn')` 返回同一个实例(便于复用 cookie 缓存)。

### D7:测试策略

- mock fetch 通过 `globalThis.fetch = vi.fn() / sinon`;HDOJ 测试使用真实 GBK 编码的 fixture 字节流。
- LeetCode CN:覆盖未登录拒绝、CSRF 注入、提交语言映射、轮询 verdict 映射(`Accepted` → AC、`Wrong Answer` → WA 等)。
- HDOJ:GBK 编解码双向、HTML 解析含中文样例、status 抓取首行 / 用户匹配。
- HttpClient:限速队列(20 req in 1s 应被节流到平台 QPS)、Cookie 注入、超时分支、POST 不重试。
- CredentialStore:`oj.cookie.*` 与 `ai.apiKey.*` 互不读取、`onChange` 触发。

### D8:依赖与体积

新增运行时依赖:
- `iconv-lite` ≥ 0.6:GBK,纯 JS。
- `cheerio` ≥ 1.0:HTML 解析,纯 JS;CLI bundle 会涉及 entities 等子依赖,可接受。

不引入 `axios`、`got`、`node-html-parser`(cheerio 已足够)。`@types/cheerio` 为 dev 依赖。

## Risks / Trade-offs

- **LeetCode CN GraphQL 字段变动** → `questionData` schema 变 → `getProblem` 抛 `PARSE_ERROR`。Mitigation:解析层对每个字段单独 try/catch,部分缺失只警告不报错。
- **HDOJ HTML 结构变动** → 样例 / 状态解析失败。Mitigation:`PARSE_ERROR` 时降级返回原始 HTML 段落,允许上层标记"样例需手动添加"。
- **HttpOnly Cookie 拿不到** → LeetCode CN 登录态依赖 `LEETCODE_SESSION` HttpOnly。Mitigation:不在 core 处理登录入口,前端通过粘贴拿到完整 cookie 后调 `credentialStore.set`。
- **GBK 编码 corner case**(罕见汉字、emoji) → 提交失败。Mitigation:`iconv-lite` 配合 `addBOM:false`、`defaultByte:'?'`;对无法编码字符给出 `PLATFORM_ERROR` 与提示。
- **限速器跨适配器误共享** → 多平台调用互相阻塞。Mitigation:`RateLimiter` 按 `platformId` 维护独立桶,Registry 注入时拆分。
- **`cheerio` 体积** → CLI bundle 偏大。Mitigation:仅在 HDOJ 适配器内 lazy import,通过 ESM `await import('cheerio')`。
- **重试导致重复提交** → 风控。Mitigation:POST `submit` 严格不重试;只有 GET 的 listProblems / getProblem / pollResult 允许重试。

## Migration Plan

本变更对用户零可见行为(没有任何 UI 接入)。开发阶段建议分两个 PR:

1. `feat/http-client + credential-store`:含单测,可独立合入。
2. `feat/leetcode-cn-adapter + hdoj-adapter`:依赖第一 PR;含单测与 fixture。

无回滚需求(纯新增 core 内代码);若下游 change 未跟上,不会暴露给用户。barrel 导出新增项不破坏向后兼容。

## Open Questions

- HDOJ 是否在 M1 内提供"账号 + 密码"直接登录?——倾向**是**,因为 HDOJ Cookie 非 HttpOnly 且登录表单简单;但 UI 在哪侧弹由各前端 change 决定。
- LeetCode CN 是否需要 `lang` ↔ `langSlug` ↔ `internal id` 三表?——M1 维护静态映射即可;`internal id` 通过 `questionData.questionId` 拿到,无需另存。
- `RateLimiter` 是否需要在 Registry 之外单独导出供测试 mock?——是,本变更顺手在 barrel 暴露。

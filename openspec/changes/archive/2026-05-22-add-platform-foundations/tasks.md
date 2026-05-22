## 1. 准备:依赖与目录骨架

- [x] 1.1 在 `packages/core/package.json` 新增 `dependencies`: `iconv-lite`、`cheerio`;`devDependencies` 新增 `@types/cheerio`(若 `cheerio@1` 自带类型则跳过)、`undici`(显式声明便于 `ProxyAgent` 类型)
- [x] 1.2 在 `packages/core/src/` 创建目录:`http/`(已存在)新增 `client.ts`、`encoding.ts`;新增 `auth/credential-store.ts`、`auth/credential-checker.ts`;在 `platform/` 新增 `errors.ts`、`registry.ts`、`leetcode-cn/`、`hdoj/`
- [x] 1.3 在 `packages/core/test/` 创建对应测试目录;不引入额外测试框架,沿用 `node --test --import tsx`
- [x] 1.4 `pnpm install` 通过;`pnpm -r build` 三个包仍能编译

## 2. http-client 公共层

- [x] 2.1 实现 `packages/core/src/http/encoding.ts`:`encodeForm(body, encoding)`、`decodeBody(bytes, encoding)`,内部 lazy import `iconv-lite`
- [x] 2.2 实现 `packages/core/src/http/client.ts`:`HttpClient.request(options)`,基于 `globalThis.fetch`,处理 query / headers / body 序列化
- [x] 2.3 集成 `RateLimiter`:按 `injectCookieFor || rateLimitKey` 决定桶 key,出网前 `limiter.tryConsume(key)`(同步);桶满抛 `AdapterError('RATE_LIMITED', retriable=true)`;两者皆缺省则跳过
- [x] 2.4 接入 GBK:`responseEncoding === 'gbk'` 时读 `response.arrayBuffer()` 经 `iconv-lite` 解码;`formEncoding === 'gbk'` 时对 form KV 先 GBK 编码再 URL-encode,`Content-Type` 设为 `application/x-www-form-urlencoded; charset=gbk`
- [x] 2.5 实现 Cookie 注入:`injectCookieFor` 触发时从 `credentialStore.get(platform)` 取 cookie 拼到 header;缺失静默透传
- [x] 2.6 实现超时:用 `AbortController` 与 `setTimeout(timeoutMs)`,与外部 `signal` 合并(`AbortSignal.any` 或手写组合)
- [x] 2.7 实现重试:仅 `method in ['GET','HEAD']` 且 `retry.attempts > 0` 时,5xx 与网络错按指数退避 + jitter 重试
- [x] 2.8 实现代理:构造选项 `proxyUrl?`,非空时 `dispatcher: new ProxyAgent(proxyUrl)` 传给 `fetch(undici)`
- [x] 2.9 实现 `AdapterError` 归一化:HTTP 状态码 → `AdapterErrorCode` 映射表(见 spec 表格)
- [x] 2.10 单测 `test/http-client.test.ts`:覆盖 GBK 双向、限速串行、Cookie 注入、超时、POST 不重试、GET 重试、429 不自动重试、代理选项透传

## 3. auth-manager-core(凭证仓库)

- [x] 3.1 实现 `packages/core/src/auth/credential-store.ts`:`CredentialStore` 接口与 `SecretCredentialStore` 类,键名 `oj.cookie.<platform>`,值 JSON
- [x] 3.2 在 `SecretCredentialStore` 内维护 `Set<Listener>`,`set/delete` 后同步 `forEach(l => l(platform))`;`onChange` 返回 `Disposable`(`dispose()` 从 Set 删除 listener)
- [x] 3.3 实现 `packages/core/src/auth/credential-checker.ts`:`CredentialChecker.check(platform)`,内部按平台调用 `userStatus` GraphQL(leetcode-cn)或 HDOJ 个人页探活;失败 catch 返回 `'unknown'`
- [x] 3.4 在 `packages/core/src/index.ts` barrel 导出 `CredentialStore`、`SecretCredentialStore`、`PlatformCredential`、`CredentialChecker`
- [x] 3.5 单测 `test/credential-store.test.ts`:set/get/delete、`oj.cookie.*` 与 `ai.apiKey.*` 互不读取、onChange 触发与 dispose、JSON 反序列化容错

## 4. platform-adapter 公共件

- [x] 4.1 实现 `packages/core/src/platform/errors.ts`:`AdapterError` 类、`AdapterErrorCode` 联合类型、`fromHttpStatus(status)` 工具函数
- [x] 4.2 实现 `packages/core/src/platform/registry.ts`:`PlatformAdapterRegistry`,构造接受 `{ httpClient, credentialStore, rateLimiter }`,`get(id)` lazy 创建并缓存;未知 id 抛 `Error`
- [x] 4.3 在 `packages/core/src/index.ts` barrel 导出 `AdapterError`、`AdapterErrorCode`、`PlatformAdapterRegistry`
- [x] 4.4 单测 `test/registry.test.ts`:`get` 引用相等、未知 id 抛错、未登录调写操作正确从适配器抛 `AUTH_REQUIRED`

## 5. leetcode-cn-adapter

- [x] 5.1 实现 `packages/core/src/platform/leetcode-cn/graphql-client.ts`:封装 `POST /graphql/`,自动注入 `Referer / Origin / Content-Type / Cookie`,提取 csrftoken 注入 `X-CSRFToken`
- [x] 5.2 实现 `packages/core/src/platform/leetcode-cn/html-to-markdown.ts`:`cheerio` 解析 `translatedContent`,`<pre>` → fenced、`<sup>/<sub>` → KaTeX、段落 / `<ul>` / `<li>` → Markdown
- [x] 5.3 实现 `packages/core/src/platform/leetcode-cn/index.ts` 中的 `LeetCodeCnAdapter`:`listProblems` 调用 `problemsetQuestionList`,映射 difficulty / tags / url
- [x] 5.4 实现 `getProblem(slug)`:`questionData` 抽取 statement / samples / codeSnippets / questionId(私有缓存)
- [x] 5.5 实现样例兜底:`exampleTestcases` 为空时从 `translatedContent` 解析 `Example N` 块
- [x] 5.6 实现 `submit`:静态语言表 `{ cpp, python3, java, javascript }`;POST `/problems/<slug>/submit/`,body `{ lang, question_id, typed_code }`;未登录抛 `AUTH_REQUIRED`,未映射语言抛 `LANG_UNSUPPORTED`
- [x] 5.7 实现 `pollResult`:`GET /submissions/detail/<sid>/check/`,退避 `[1,2,3,5,5,...]`,总超时 60s;verdict 映射(见 spec);CE 透传 `full_compile_error`
- [x] 5.8 在 `packages/core/src/platform/registry.ts` 中把 `'leetcode-cn'` 注册到工厂
- [x] 5.9 单测 `test/leetcode-cn-adapter.test.ts`:mock fetch 覆盖 listProblems(关键字 / 难度 / 分页)、getProblem(题面解析 / 样例兜底 / 模板)、submit(语言映射 / CSRF 注入 / 未登录拒绝)、pollResult(state 转换 / CE 透传 / 60s 超时)

## 6. hdoj-adapter

- [x] 6.1 实现 `packages/core/src/platform/hdoj/cheerio-loader.ts`:lazy import `cheerio` 并复用
- [x] 6.2 实现 `packages/core/src/platform/hdoj/html-parsers.ts`:`parseListPage(html)`、`parseProblemPage(html)`、`parseStatusFirstRow(html, username, runIdHint)`,均接收 UTF-8 字符串(已由 HttpClient GBK 解码)
- [x] 6.3 实现 `packages/core/src/platform/hdoj/index.ts` 中的 `HDOJAdapter.listProblems`:抓 `listproblem.php?vol=<n>`,按通过率推断 difficulty
- [x] 6.4 实现 `getProblem(pid)`:抓 `showproblem.php?pid=<pid>`,按段标题切分;`<pre>` 配对生成 samples;解析失败抛 `PARSE_ERROR`
- [x] 6.5 实现 `submit`:静态语言表 `{ cpp:0, c:3, java:5, python3:11 }`(实现时二次校对平台当前值);GBK 表单 POST `/submit.php?action=submit`,带 `Referer`
- [x] 6.6 实现 `pollResult`:轮询 `status.php?user=<u>&pid=<pid>&first=&noprivate=1`,匹配 RunID;CE 时拉 `viewerror.php?rid=<sid>` 透传
- [x] 6.7 实现 GBK 不可编码字符检测:`iconv-lite.encode` 设 `defaultByte: 0x00`,后检查若含 `0x00` 抛 `PLATFORM_ERROR`
- [x] 6.8 在 `registry.ts` 注册 `'hdoj'` 工厂
- [x] 6.9 单测 `test/hdoj-adapter.test.ts`:用 GBK 编码的 fixture 字节流;listProblems 解析、题面与样例解析、submit 中文编码、status 解析、emoji 拒绝、login() 直接抛 AUTH_REQUIRED

## 7. barrel 与 公共导出

- [x] 7.1 更新 `packages/core/src/index.ts`,新增导出:`HttpClient`、`HttpRequest`、`HttpResponse`、`CredentialStore`、`SecretCredentialStore`、`CredentialChecker`、`PlatformCredential`、`AdapterError`、`AdapterErrorCode`、`PlatformAdapterRegistry`、`RateLimiter`(若未导出)
- [x] 7.2 不破坏已有 AI 导出;`pnpm -r build` 仍通过
- [x] 7.3 `grep -r "from 'vscode'" packages/core/src` 仍无结果

## 8. 验证

- [x] 8.1 `pnpm install` 与 `pnpm -r build` 全绿
- [x] 8.2 `pnpm --filter @oj-agent/core test` 全部新单测通过且 ≥ 90% 行覆盖适配器路径
- [x] 8.3 手动 smoke:`node -e "const {PlatformAdapterRegistry, HttpClient, SecretCredentialStore} = require('@oj-agent/core'); ..."` 可以构造 registry 并 `get('leetcode-cn')` / `get('hdoj')` 拿到实例
- [x] 8.4 验证 `packages/cli` 与 `packages/vscode` 在不修改任何业务代码的情况下,`import { PlatformAdapterRegistry } from '@oj-agent/core'` 编译通过
- [x] 8.5 文档:在 `packages/core/README.md` 追加 "Platform Adapters" 段(已存在 README 则追加;不存在则跳过,不新建文件) — 文件不存在,按规则跳过
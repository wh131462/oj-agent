## Why

`add-monorepo-layout` 已搭好 `core/cli/vscode` 三包骨架,但 `@oj-agent/core` 中 `platform/adapter.ts` 仅有接口类型,没有任何具体平台实现,也没有跨平台共用的 HTTP 与凭证基础设施。M1 闭环(拉取→测试→提交)的所有上层能力(CLI 命令、VSCode 视图、判题器、工作区)都需要先有一套可用的"平台调用栈"作为前置:HTTP 客户端、凭证仓库、LeetCode CN 与 HDOJ 两个具体适配器。本变更只负责把这一层在 `@oj-agent/core` 内落地,使后续 change 可以直接调用 `adapter.listProblems/getProblem/submit/pollResult`,而不必再关心 Cookie 注入、GBK 编码、限速与登录态。

## What Changes

- **新增** `@oj-agent/core` 内 `http/client.ts`:基于内置 `fetch` 的 `HttpClient`,集成限速、超时、Cookie 注入、`responseEncoding='gbk'` / `formEncoding='gbk'`、`http.proxy` 透传、幂等重试,作为后续所有适配器的唯一出网通道。
- **新增** `@oj-agent/core` 内 `auth/credential-store.ts`:`CredentialStore` 接口与基于 `SecretBackend` 的实现,键名命名空间 `oj.cookie.<platform>`,与已有 `ai.apiKey.*` 严格隔离;提供 `get/set/delete/onChange` 与登录态探活辅助。
- **新增** `@oj-agent/core` 内 `platform/leetcode-cn/`:GraphQL 客户端(`questionData / problemsetQuestionList / submit / submissions/detail/.../check/`)、Markdown 抽取、`exampleTestcases` 解析、`codeSnippets` 暴露、语言映射表、verdict 归一化。
- **新增** `@oj-agent/core` 内 `platform/hdoj/`:`listproblem.php / showproblem.php / submit.php / status.php` 的 HTML 爬取与 GBK 表单提交,`cheerio` 抽取题面与样例,语言 ID 表与 verdict 归一化。
- **新增** `PlatformAdapterRegistry`:按 `PlatformId` 创建适配器实例,统一注入 `HttpClient + CredentialStore + RateLimiter`。
- **新增** 错误归一化:适配器内部所有错误统一抛 `AdapterError { code, message, retriable, source }`,UI/CLI 只看 `code`。
- **修改** `@oj-agent/core` barrel(`packages/core/src/index.ts`):新增 `HttpClient / CredentialStore / SecretBackend(若已存在则复用) / PlatformAdapterRegistry / AdapterError / 各 verdict 与语言映射` 导出。
- **新增** 运行时依赖:`iconv-lite`(GBK)、`cheerio`(HDOJ HTML 解析)。
- **不变** AI 路径、`packages/vscode` 与 `packages/cli` 任何代码、PRD 文档。

## Capabilities

### New Capabilities

- `http-client`: 公共 HTTP 客户端契约:限速队列、超时、幂等重试、Cookie 注入、GBK 双向编码、代理透传。
- `auth-manager-core`: `core` 层凭证仓库契约:命名空间隔离的 `CredentialStore`、登录态探活、`SecretBackend` 适配规范(具体后端由各前端实现)。
- `platform-adapter`: `PlatformAdapter` 接口、`AdapterError` 归一化、`PlatformAdapterRegistry` 装配与依赖注入规范。
- `leetcode-cn-adapter`: LeetCode CN GraphQL 实现:题目列表、详情、样例、模板、提交、轮询。
- `hdoj-adapter`: HDOJ HTML 爬取实现:题目列表、详情、样例、表单提交、状态查询;GBK 编码处理。

### Modified Capabilities

<!-- 不修改任何已存在的 spec 的 Requirement。-->

## Impact

- **代码**:在 `packages/core/src/` 下新增 `http/client.ts`、`auth/credential-store.ts`、`platform/registry.ts`、`platform/errors.ts`、`platform/leetcode-cn/*`、`platform/hdoj/*`;扩展 `packages/core/src/index.ts` barrel。
- **依赖**:`packages/core/package.json` 新增 `iconv-lite`、`cheerio` 与对应 `@types/*`;`pnpm-lock.yaml` 更新。
- **配置**:不动 VSCode `package.json` 与 CLI 入口;OJ Cookie 与 AI Key 在 `SecretBackend` 中以前缀隔离(`oj.cookie.*` vs `ai.apiKey.*`)。
- **测试**:`packages/core/test/` 下新增 `http-client.test.ts`、`credential-store.test.ts`、`leetcode-cn-adapter.test.ts`、`hdoj-adapter.test.ts`;全部走 mock fetch,不发真实网络请求。
- **下游 change**:`add-judge-and-workspace` / `add-cli-m1-commands` / `add-vscode-m1-views` 均依赖本变更完成。

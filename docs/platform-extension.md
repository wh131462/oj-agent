# 扩展一个新 OJ 平台

本指南说明如何为 OJ-Agent 新增一个平台适配器，从而让 CLI 与 VSCode 扩展同时支持新的 OJ。

适配器的核心思想：把任意一家 OJ 的「列题、看题、提交、查结果、登录」抽象成同一组方法。CLI 与 VSCode 都只依赖统一接口，与具体平台彻底解耦。

---

## 总体流程

新增一个平台需要走完以下五步：

1. 在 `packages/core/src/platform/` 下新建目录，例如 `myoj/`
2. 实现 `PlatformAdapter` 接口（最少 5 个核心方法）
3. 在 `packages/core/src/platform/adapter.ts` 的 `PlatformId` 联合类型中追加新的 id
4. 在 `packages/core/src/platform/registry.ts` 的 switch 中注册适配器构造
5. 在 VSCode 扩展 `packages/vscode/package.json` 的 `ojAgent.platforms.enabled` 配置 enum 中追加 id

完成后即可通过 `oja list myoj` / `oja pull myoj/<id>` 等命令访问新平台，VSCode 题库 TreeView 也会出现该平台节点。

---

## 接口契约

适配器必须实现 `PlatformAdapter` 接口，定义在 `packages/core/src/platform/adapter.ts`。

### 必填字段

- `id`：平台唯一标识，需与 `PlatformId` 联合类型中的字符串完全一致
- `capabilities`：能力声明对象，标记本适配器对以下 5 项的支持情况
  - `listProblems`：是否支持题目列表拉取
  - `getProblem`：是否支持题目详情拉取
  - `submit`：是否支持在线提交
  - `pollResult`：是否支持轮询判题结果
  - `autoLogin`：是否支持浏览器自动登录
- `supportedLangs`：本平台可提交的语言数组，字符串语义需与 `submit(id, lang, code)` 第二参数保持一致（如 `cpp` / `c` / `python3` / `java` / `javascript`）

### 可选字段

- `degraded`：降级说明数组。当某项 capability 部分可用或附条件可用时填写，每项含 `capability` / `reason` / `hint`。例如蓝桥云课的题目详情/提交需要 JWT，未配置时即视为降级
- `getProblemLangs(id)`：题目级语言能力查询。能从平台拿到「这道题真实可用语言 + 代码模板」时实现（如 LeetCode）；不实现时调用方自动 fallback 到 `supportedLangs`

### 必填方法

- `login()`：返回 `PlatformCredential`（含 `cookie` / `token` / `extra`）。仅支持账号密码或 JWT 的平台可直接在此抛 `AdapterError('AUTH_REQUIRED', ..., false)`，由前端走粘贴 / 表单登录流程后写入凭证仓库
- `listProblems(query)`：按分页 / 关键字 / 难度 / 标签返回题目摘要数组
- `getProblem(id)`：返回题面、样例、时间/内存限制；statement 为 markdown 文本
- `submit(id, lang, code, platformLangId?)`：发起提交，返回平台返回的 submission id。`platformLangId` 由调用方通过 `getProblemLangs` 预解析得到时优先使用，未提供则适配器内部根据 `lang` 走静态映射
- `pollResult(sid)`：轮询一次判题结果，返回 verdict / 时间 / 内存 / 用例数等。调用方负责重复轮询，不要在 adapter 内部 sleep loop

verdict 枚举：`AC` / `WA` / `TLE` / `MLE` / `RE` / `CE` / `PE` / `PENDING` / `JUDGING` / `UNKNOWN`。

---

## 依赖注入

适配器构造函数接收 `RegistryDeps`，由注册表统一注入：

- `httpClient`：统一 HTTP 客户端（含代理、超时、重试、UA 处理）
- `credentialStore`：凭证仓库���读取 OJ Cookie / Token
- `rateLimiter`：限流器，遵守 `ojAgent.http.rateLimit.<platform>` 配置

**所有外部网络请求都必须走 `httpClient`**，禁止直接 `fetch`，否则会绕过代理、限流与超时设置。

---

## 错误处理

统一抛出 `AdapterError`（`packages/core/src/platform/errors.ts`）：

- `AUTH_REQUIRED`：未登录或凭证失效
- `RATE_LIMITED`：被平台限速
- `NETWORK`：网络错误
- `PARSE`：HTML / JSON 解析失败
- `NOT_FOUND`：题目 / 提交不存在
- `REJECTED`：平台明确拒绝（如不支持的语言）

第三参数 `retriable: boolean` 决定调用方是否会自动重试。

---

## 实现要点

### HTML 爬取型（POJ / HDOJ / 洛谷）

- 使用 cheerio 解析 HTML，把页面结构剥离到独立的 `parse.ts` / `html-parsers.ts`，便于单测
- 注意编码：POJ 是 GBK，需在 httpClient 调用处显式处理
- 列表分页：将平台原生分页（如 POJ 的 volume）映射到 `query.page`

### API 型（LeetCode CN / Codeforces）

- LeetCode 用 GraphQL，统一封装请求体；注意 csrftoken 与 Cookie 联动
- Codeforces 有公开 API 用于列题，提交仍需走 HTML 表单

### 凭证型差异

- Cookie 型：`PlatformCredential.cookie` 写整段 cookie 字符串
- Token 型：`PlatformCredential.token` 存 JWT
- 复合型：`PlatformCredential.extra` 存额外字段（如 csrftoken / 用户名）

---

## 参考实现

仓库内已有 6 个完整实现可对照阅读，按复杂度从低到高：

- `packages/core/src/platform/poj/` —— 最小 HTML 爬取型，登录走粘贴，无自动登录
- `packages/core/src/platform/hdoj/` —— HTML 型 + 账号密码登录
- `packages/core/src/platform/codeforces/` —— 混合 API + HTML 表单
- `packages/core/src/platform/luogu/` —— Cookie 型 + API
- `packages/core/src/platform/leetcode-cn/` —— GraphQL + 题目级语言能力（`getProblemLangs` 完整实现）
- `packages/core/src/platform/lanqiao/` —— JWT + `degraded` 字段示范

---

## 测试与验证

新增适配器后建议在 `packages/core/test/platform/<myoj>/` 下补充单测：

- 解析层（HTML / JSON 解析）用固定 fixture 跑纯 mock 测试
- 适配器层用 mock 的 `httpClient` 覆盖 `listProblems` / `getProblem` / `submit` / `pollResult` 主路径

集成验证：

1. `pnpm -r build`
2. `node packages/cli/dist/index.js platforms` 应能看到新平台
3. `oja list myoj` 验证列表
4. `oja pull myoj/<id>` 验证拉题
5. 登录后 `oja submit` 验证提交闭环

---

## PR 共建

欢迎通过 PR 贡献新平台适配器。提交前请确认：

- 适配器接口完整，`capabilities` 与 `degraded` 如实声明
- 所有网络请求走 `httpClient`，无直接 `fetch` / `axios`
- 凭证仅通过 `credentialStore` 读写，不在代码中硬编码
- 单测覆盖解析层与适配器主路径
- 在 PR 描述中附上「能力矩阵 + 已知限制」清单

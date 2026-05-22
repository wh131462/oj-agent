> **STATUS: SUPERSEDED by `add-monorepo-layout` (2026-05-21)**
>
> 本提案按"单 VSCode 包"形态设计。后续团队决定将核心能力 CLI 化并采用 Monorepo 分层架构（详见 `openspec/changes/add-monorepo-layout/`），原提案的范围（M1 平台闭环实现）将在新架构落地后重新拆分。文件保留作为历史参考，不再继续推进。

## Why

PRD 已确定 M1 阶段目标为「跑通 拉取 → 本地测试 → 提交 → 看结果 全流程」，覆盖 LeetCode CN 与 HDOJ 两个平台。当前仓库仅实现 AI 助手（`ai-assistant` / `model-provider`），尚无任何 OJ 平台核心闭环能力，需要在 M1 内补齐统一适配器、账号管理、题面渲染、本地判题、在线提交与工作区组织，使插件具备首个可演示原型。

## What Changes

- **新增** 统一的 `PlatformAdapter` 接口与 LeetCode CN（GraphQL）、HDOJ（HTML + GBK）两个平台适配实现，提供 `listProblems / getProblem / submit / pollResult` 能力。
- **新增** `auth-manager`：基于 VSCode Webview 完成两平台登录、提取 Cookie/Token 并以独立命名空间存入 `SecretStorage`，状态栏展示登录状态、检测失效并提示重登。
- **新增** `http-client` 公共层：限速队列、超时、重试、Cookie 注入、代理、GBK 解码（POJ/HDOJ 系列预留）。
- **新增** 题库 TreeView（按平台分组、分页 / 关键字 / 难度 / 标签筛选）。
- **新增** 题面 Webview：渲染 Markdown + KaTeX，自动解析样例并落盘为本地用例文件；自动生成代码模板（优先采用平台 `codeSnippet`）；按 `workspace/<platform>/<id>-<slug>-<YYYY-MM-DD>/` 组织目录。
- **新增** `judge-runner`：检测本地 g++/python/java/node 工具链，按用例顺序编译运行，喂入 stdin、捕获 stdout、按 OJ 归一化规则 diff，输出结果面板。
- **新增** 在线提交：语言映射、CSRF / 登录态处理、提交后轮询判题结果、状态栏与结果面板实时展示 AC/WA/TLE/CE 等；可配置请求间隔。
- **新增** 配置项：工作区根目录、各语言编译命令、默认提交语言、请求间隔/超时/代理。
- **修改** AI 助手与平台联动：题面 Webview 与本地测试结果面板按 `ai-assistant` 规范挂载四类 AI 入口（解释错因 / 生成思路 / 生成题解 / 解释代码），上下文由本变更新增的 `context-source` 适配层组装；在未配置 Profile 时按既有规范禁用入口。
- **新增** 离线缓存：已拉取题目（题面、样例、元数据）持久化到本地工作区，断网可读，远程更新按需刷新。

## Capabilities

### New Capabilities

- `platform-adapter`: 定义跨平台统一接口契约，约束各 OJ 适配器的拉取 / 提交 / 轮询 / 错误归一化行为。
- `leetcode-cn-adapter`: LeetCode CN 平台 GraphQL 实现，覆盖题目列表、详情、样例、代码模板、提交、结果轮询。
- `hdoj-adapter`: HDOJ 平台 HTML 爬取 + GBK 解码实现，覆盖题目列表、详情、样例、表单提交、状态查询。
- `auth-manager`: 基于 Webview 登录与 `SecretStorage` 的多平台凭证管理，含失效检测与重登提示。
- `http-client`: 限速、重试、超时、Cookie 注入、代理与编码转换的公共 HTTP 客户端规范。
- `problem-workspace`: 工作区目录组织、题面落盘、样例文件、代码模板生成、离线缓存读写规范。
- `judge-runner`: 本地编译、运行、stdin 注入、stdout 捕获、输出归一化 diff、超时控制、结果面板呈现。
- `submission-runner`: 在线提交流程、语言映射、CSRF 处理、提交后轮询、结果面板与状态栏更新规范。
- `problem-ui`: 题库 TreeView 与题面 Webview 的视图、命令、筛选、分页、Markdown + KaTeX 渲染规范。

### Modified Capabilities

- `ai-assistant`: 新增"上下文来源"小节，规定题面 Webview / 本地测试结果面板作为 AI 入口的承载位置，并由本变更提供 `ProblemContext / TestCaseContext` 数据结构供 `context-builder` 使用。

## Impact

- **代码**：新增 `src/core/platform/`（含 `types.ts`、`leetcode-cn/`、`hdoj/`）、`src/core/auth/`、`src/core/http/`（扩展现有 `rate-limiter.ts`）、`src/core/workspace/`、`src/core/judge/`、`src/core/submission/`、`src/extension/views/`（TreeView、题面 Webview、结果面板）、`src/extension/commands.ts`（追加 OJ 相关命令）。
- **配置**：`package.json` 新增 `ojAgent.workspace.*`、`ojAgent.lang.*`、`ojAgent.http.*` 配置项与若干命令、视图。
- **依赖**：引入 `iconv-lite`（GBK 解码）、`cheerio`（HTML 解析）、`katex`、`markdown-it`、`markdown-it-katex`（Webview 渲染）。AI 路径不引入新依赖。
- **凭证存储**：OJ 凭证使用 `oj.cookie.<platform>` 命名空间，与 AI 的 `ai.apiKey.*` 严格隔离。
- **测试**：新增适配器单元测试（mock HTTP）、judge-runner 子进程测试、Webview 端到端冒烟测试。

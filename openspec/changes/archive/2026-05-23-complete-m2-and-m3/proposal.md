## Why

M0/M1 已完成 Monorepo 骨架与 LeetCode CN + HDOJ 双平台核心闭环。要兑现 PRD §7 的产品承诺（六平台覆盖 + 双前端发布），需在一次集中冲刺中并行推进 M2（Codeforces + 洛谷）与 M3（POJ + 蓝桥云课 + 配置打磨 + 发布），避免平台适配工作分散为多个长尾改动，并将 vsce/Monorepo 打包问题、配置体验问题与平台扩展同步收口，统一释放为可发布版本。

## What Changes

- **新增** Codeforces 适配器：`problemset.problems` 官方 API 取元数据，登录会话取题面 HTML 并解析 `.problem-statement`，提交后兜底跳转提交记录页。
- **新增** 洛谷适配器：解析 `<script id="lentille-context">` 页面 JSON 取列表与题面 Markdown，提交前抓取 `<meta name="csrf-token">`。
- **新增** POJ 适配器：HTML 爬取列表/题面（GBK 转码），表单 POST 提交，超时与重试配置高于其他平台。
- **新增** 蓝桥云课适配器：`/api/v2/problems/` 公共列表 + JWT 认证后取详情/提交，明确标记部分能力不可用并降级提示。
- **新增** Cloudflare/易盾绕过策略：在 `http-client` 中支持复用登录会话发起请求，避免在未登录态下命中 Turnstile/易盾。
- **修改** 配置体验：补齐 CLI/VSCode 双端的工作区根目录、语言编译命令、请求间隔、代理、AI Profile 切换的可视化设置入口与 `oja config` 子命令。
- **修改** `vscode` 打包流水线：用 `pnpm deploy` 落地完整 `node_modules`（必要时 esbuild 兜底打包 core），解决 `vsce package` 在 Monorepo 下对 `workspace:*` 的解析问题。
- **修改** 文档与发布：补齐六平台使用说明、登录指引、平台能力矩阵；准备 VSCode Marketplace 与 npm 发布元数据（README/CHANGELOG/icon/keywords）。
- **新增** 发布流程：`release` 脚本统一驱动 core/cli/vscode 的版本号、changelog、`npm publish`、`vsce publish`。

## Capabilities

### New Capabilities

- `codeforces-adapter`: Codeforces 平台适配器，覆盖列表/题面/提交/轮询四类能力，并处理 Cloudflare 拦截。
- `luogu-adapter`: 洛谷平台适配器，基于页面内嵌 JSON 解析与 CSRF Token 提交。
- `poj-adapter`: POJ 平台适配器，HTML 爬取 + GBK 转码 + 慢响应重试。
- `lanqiao-adapter`: 蓝桥云课平台适配器，公共列表 + JWT 认证详情/提交，能力降级标识。
- `release-pipeline`: 跨包统一的版本/发布流水线，覆盖 core (npm)、cli (npm bin) 与 vscode (vsce package/publish)。

### Modified Capabilities

- `platform-adapter`: 适配器契约新增「能力降级标识」字段，允许适配器声明部分能力（如详情、提交）需登录或不可用。
- `http-client`: 支持按平台注入会话上下文与超时/重试策略，提供 GBK/UTF-8 编码自动协商与 Cloudflare 友好的请求头预设。
- `cli-commands`: 新增 `oja config get/set/list` 子命令、`oja platforms` 能力矩阵展示，并在 `browse/list` 中支持 Codeforces/洛谷/POJ/蓝桥的过滤参数。
- `vscode-backends`: 新增设置面板暴露工作区根目录、请求间隔、代理、AI Profile 选择项；处理新平台的状态栏与登录入口。
- `monorepo-layout`: 调整 `vscode` 包打包策略以解决 `workspace:*` 依赖落地问题；新增统一发布脚本与版本号管理约定。

## Impact

- 新增 `packages/core/src/platform/codeforces/`、`luogu/`、`poj/`、`lanqiao/` 四个适配器目录及测试。
- 修改 `packages/core/src/platform/adapter.ts`、`registry.ts`、`http/`，扩展契约与会话注入。
- 修改 `packages/cli/src/commands/`、`packages/cli/src/backends/toml-config.ts`，新增 `config` 子命令族与平台能力展示。
- 修改 `packages/vscode/package.json`、`extension/settings-panel.ts`、`extension/views/`、构建脚本，落地设置面板与新平台 UI。
- 新增 `scripts/release.mjs`（或 `pnpm` workspace script）与 `.vscodeignore`、`pnpm deploy` 配置；调整 CI/发布工作流。
- 新增依赖：`iconv-lite`（POJ/HDOJ 已用，可复用）、`cheerio`（HTML 解析，若已存在则复用）；评估 `@vscode/vsce` 打包脚本调整，无新增运行时依赖。
- 影响发布产物：首个 npm `@oj-agent/core`、`@oj-agent/cli` 与 VSCode Marketplace `oj-agent` 扩展上架。

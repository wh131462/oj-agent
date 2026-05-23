## Context

M0/M1 已交付 Monorepo 骨架 + LeetCode CN + HDOJ 双平台核心闭环、AI 助手、CLI 与 VSCode 双前端。本变更并行推进 M2（Codeforces + 洛谷）与 M3（POJ + 蓝桥云课 + 配置打磨 + 发布），目标是一次冲刺把六平台、配置体验与首版发布同时收尾。

约束：
- core 必须保持零 VSCode 依赖；新平台仅落在 `packages/core/src/platform/<id>/`。
- 既有 `PlatformAdapter` 契约不可破坏 LeetCode CN/HDOJ 适配器；变更通过新增可选字段实现。
- 凭证仍走 `SecretBackend`，不引入新存储后端。
- 反爬不做主动绕过，仅利用已登录会话；Cloudflare/易盾人机验证由用户在前端完成。
- VSCode 打包必须能在 CI 中无人工干预完成 `vsce package`/`vsce publish`。

相关方：终端用户（六平台覆盖、配置可视化）、维护者（发布流水线一次跑通）。

## Goals / Non-Goals

**Goals:**
- 在 core 中落地 Codeforces / 洛谷 / POJ / 蓝桥云课 四个新适配器，全部至少覆盖列表 + 题面 + 提交 + 轮询四类能力，蓝桥云课明确降级。
- CLI 与 VSCode 双端可视化暴露工作区目录、请求间隔、代理、AI Profile 切换等核心配置。
- 解决 `vsce package` 在 Monorepo 下对 `workspace:*` 的解析问题，输出可直接 publish 的 `.vsix`。
- 提供统一 release 脚本，能一次性发布 `@oj-agent/core`、`@oj-agent/cli`（npm）与 `oj-agent`（VSCode Marketplace）。
- 文档同步更新六平台使用说明、登录指引、平台能力矩阵。

**Non-Goals:**
- 不主动绕过 Cloudflare/易盾，不实现自动验证码识别。
- 不为蓝桥云课实现在线 IDE 评测兼容。
- 不重写既有 LeetCode CN/HDOJ 适配器，不改动 core 已有的 judge/ai 模块。
- 不引入新的密钥存储后端或新的认证模型。
- 不在本变更中扩展 AI 助手到新场景（仅保留 M1 已有能力）。

## Decisions

### 适配器分包结构
每个新平台落在 `packages/core/src/platform/<id>/` 下，至少包含 `index.ts`（实现 `PlatformAdapter`）、`api.ts`（HTTP 层）、`parse.ts`（HTML/JSON 解析）、`types.ts`。新增适配器在 `registry.ts` 注册，便于按 `platformId` 动态加载。

备选：把多平台塞进同一文件以减少文件数。**拒绝**——`leetcode-cn/` 的目录结构已被证明利于测试与解析逻辑隔离。

### `PlatformAdapter` 契约扩展
新增可选字段：
- `capabilities: { listing: 'public'|'auth-required'; detail: ...; submit: ... }`：声明各能力的认证需求与可用性。
- `degraded?: { reason: string; affected: ('listing'|'detail'|'submit'|'poll')[] }`：用于蓝桥云课等部分能力不可用的场景。

CLI/VSCode 通过 `capabilities` 决定是否在 UI 中显示登录前置提示，通过 `degraded` 触发降级提示而不是抛错。

备选：直接在每个方法里抛特定错误码。**拒绝**——前端需要在拉取列表前就知道哪些能力可用，事后抛错体验差。

### Cloudflare/易盾的最小可行策略
`http-client` 增加 `withSession(platformId)` 抽象，对 Codeforces/洛谷请求自动注入：
- 已登录会话的 Cookie；
- 浏览器化的 `User-Agent`、`Accept-Language`、`Referer`；
- 失败时直接返回 `NeedsHumanVerification` 错误，由前端引导用户在浏览器里完成验证后重试。

不内置任何打码或反检测脚本，避免维护成本与法律风险。

### 洛谷数据来源
所有列表/题面通过解析页面 `<script id="lentille-context">` 取得，**不**调用 `?_contentOnly=1`。提交前从详情页解析 `<meta name="csrf-token">` 并在 POST 中带上。

备选：直接调用非官方 JSON 接口。**拒绝**——research.md 已记录其参数不稳定。

### POJ 编码与超时
复用 HDOJ 的 GBK 解码逻辑（`iconv-lite`），单独设置默认 30s 超时 + 一次重试（其他平台默认 10s 无重试），通过 `http-client` 的平台配置表注入。

### 蓝桥云课的降级模型
适配器实现 `listProblems` 返回公开数据；`getProblem` / `submit` 在无 JWT 时直接返回 `degraded` 错误并提示登录。已登录时尽力调用 `/api/v2/problems/{id}/`，但若返回 401/403 仍降级。前端在题库 TreeView/CLI 列表中显示 "⚠ 详情需登录"。

### 配置与设置体验
- CLI：新增 `oja config get/set/list/unset`，复用现有 `toml-config.ts` 后端；新增 `oja platforms` 输出能力矩阵（含 `capabilities` / `degraded`）。
- VSCode：在现有 `settings-panel.ts` Webview 中分组展示「工作区」「网络」「平台」「AI Profile」四块，写回 `vscode.workspace.getConfiguration`；通过 `ConfigBackend` 抽象与 CLI 共享 schema。
- 配置 schema 集中在 `packages/core/src/config/schema.ts`，两端各自适配。

### VSCode 打包：`pnpm deploy` + esbuild 兜底
首选 `pnpm deploy --filter oj-agent --prod packages/vscode/dist-deploy`，把 `@oj-agent/core` 落成真实文件后再 `vsce package` 该目录。备选 `esbuild` 把 core 打成单文件 bundle（`packages/vscode/dist/extension.js`），用于 marketplace 文件大小敏感的场景。脚本通过环境变量 `OJA_VSCE_MODE=deploy|bundle` 切换，默认 `deploy`。

备选：手动 `pnpm pack` core 后写到扩展目录。**拒绝**——脆弱、易遗漏、CI 不友好。

### Release 流水线
新增 `scripts/release.mjs`：
1. 读取 `pnpm -r ls --json` 获取受影响包。
2. 依次执行 `pnpm -r build` → `pnpm -r test` �� `changeset version`（若引入 changesets）或显式版本号。
3. `pnpm -r publish --access public --no-git-checks` 发布 npm 包。
4. `pnpm --filter oj-agent vsce:publish`（包装 `vsce publish`）发布扩展。
5. 失败时停在当前步骤并打印回滚指引，不强行回滚已发布的 npm 版本。

版本管理：采用 changesets 还是手动版本号在 Open Questions 中留待落地时决策。

## Risks / Trade-offs

- Cloudflare/易盾验证升级 → 复用登录态 + `NeedsHumanVerification` 错误码降级提示；用户需在浏览器手动完成验证。
- 洛谷页面结构变动（`lentille-context` 字段调整） → 在 `parse.ts` 集中处理，加 schema 校验失败时给出明确错误信息；定期跑端到端 smoke。
- POJ 服务器慢/超时频发 → 默认更长超时 + 单次重试 + CLI/VSCode 显示 "POJ 当前响应较慢" 友好提示。
- 蓝桥云课能力降级用户感知差 → 在 UI 显式标注降级原因，避免被当作 bug。
- `pnpm deploy` 在 CI 与本地表现不一致 → 在 CI 中固定 pnpm 版本，本地脚本支持 `--mode bundle` 兜底。
- 首次 npm/Marketplace 发布命名冲突 → 提前 dry-run（`npm publish --dry-run`、`vsce ls`）确认包名与扩展 ID 可用。
- 平台契约新增字段可能破坏现有适配器 → 全部字段为可选 + 默认值，并在 core 中提供类型保护函数。

## Migration Plan

1. **契约升级先行**：先合入 `PlatformAdapter` 的可选字段与 `http-client` 会话注入，LeetCode CN / HDOJ 适配器补 `capabilities`，保证现有功能零回归。
2. **平台适配器分两批合入**：M2（Codeforces + 洛谷） → M3（POJ + 蓝桥云课），每个平台单独 PR，含解析单测 + smoke。
3. **配置体验**：CLI `oja config` 与 VSCode 设置面板并行开发，共享 `core/config/schema.ts`。
4. **打包与发布**：先在 PR 中跑通 `pnpm deploy` + `vsce package` 产出本地 `.vsix`；release 脚本最后合入。
5. **发布**：先发 `@oj-agent/core` 与 `@oj-agent/cli` 到 npm，再发 `oj-agent` 到 Marketplace，留 24h 观察后归档变更。

回滚：
- npm 已发版本无法删除，仅能 `npm deprecate` 旧版本并发布修复版；
- Marketplace 可下架 `.vsix` 版本；
- 适配器层面通过 `registry.ts` 临时下线问题平台。

## Open Questions

- 是否引入 `changesets` 管理版本号，还是用手动 `pnpm version`？倾向 `changesets`，待与维护者确认。
- 是否在 release 流水线中加入 GitHub Release 自动生成？可作为后续增强。
- 蓝桥云课的登录方式（passport.lanqiao.cn 跳转）是否复用 browser-auto-login 后端？需要确认 OAuth 流是否兼容现有 playwright 后端。
- AI Profile 的设置面板是否同时支持新增/删除 Profile，还是仅切换激活 Profile？倾向后者，避免与现有 `oja ai profile` 命令重复。

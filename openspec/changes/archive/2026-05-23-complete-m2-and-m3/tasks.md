## 1. 契约升级与共享基建

- [x] 1.1 在 `packages/core/src/platform/adapter.ts` 新增 `PlatformCapabilities`、`PlatformDegradedInfo` 类型,扩展 `PlatformAdapter` 必填 `capabilities` 与可选 `degraded` 字段
- [x] 1.2 为现有 `LeetCodeCnAdapter` / `HDOJAdapter` 补全 `capabilities` 字段(行为不变),并补充类型测试
- [x] 1.3 在 `packages/core/src/http/` 增加 `withSession(platformId)` 工具,统一注入 Cookie + 浏览器化请求头
- [x] 1.4 在 `HttpClient` 中增加按 `platformId` 索引的超时/重试配置表(POJ 默认 30s + 1 次重试)
- [x] 1.5 在 `HttpClient` 中检测 Cloudflare/易盾响应(`cf-turnstile`、易盾标记)并抛 `AdapterError('AUTH_REQUIRED')`
- [x] 1.6 在 `packages/core/src/config/schema.ts` 集中声明 `workspace.root / network.* / ai.activeProfile` 等配置 schema,供 CLI 与 VSCode 复用

## 2. Codeforces 适配器(M2)

- [x] 2.1 创建 `packages/core/src/platform/codeforces/{index,api,parse,types}.ts`
- [x] 2.2 实现 `listProblems` 调用 `problemset.problems` API,字段映射到 `PlatformProblemSummary`
- [x] 2.3 实现 `getProblem` 通过 `withSession('codeforces')` 抓取 HTML,解析 `.problem-statement` 为 Markdown + 样例
- [x] 2.4 实现 `submit` / `pollResult`,结果含 `detailUrl` 供前端打开提交记录页
- [x] 2.5 在 `registry.ts` 注册 `codeforces`,补单测(列表解析、HTML 解析、Cloudflare 拦截分支)

## 3. 洛谷适配器(M2)

- [x] 3.1 创建 `packages/core/src/platform/luogu/{index,api,parse,types}.ts`
- [x] 3.2 实现 `listProblems` 解析 `<script id="lentille-context">` JSON
- [x] 3.3 实现 `getProblem` 解析题面 Markdown(含 LaTeX),并对 schema 缺失抛 `PARSE_ERROR`
- [x] 3.4 实现 `submit` 抓取 `<meta name="csrf-token">` 并随表单提交
- [x] 3.5 实现 `pollResult` 轮询提交记录
- [x] 3.6 在 `registry.ts` 注册 `luogu`,补单测(JSON 解析、CSRF 抓取、易盾分支)

## 4. POJ 适配器(M3)

- [x] 4.1 创建 `packages/core/src/platform/poj/{index,api,parse,types}.ts`
- [x] 4.2 复用 HDOJ 的 GBK 解码,实现 `listProblems` 与 `getProblem`
- [x] 4.3 通过平台超时配置表使用 30s 超时 + 1 次重试
- [x] 4.4 实现 `submit` / `pollResult`,处理表单 POST 与登录态
- [x] 4.5 在 `registry.ts` 注册 `poj`,补单测(GBK 解码、超时重试、列表分页)

## 5. 蓝桥云课适配器(M3)

- [x] 5.1 创建 `packages/core/src/platform/lanqiao/{index,api,parse,types}.ts`
- [x] 5.2 实现 `listProblems` 调用 `/api/v2/problems/`(无需登录)
- [x] 5.3 实现 `getProblem` / `submit` 携带 JWT,401/403 时抛 `AUTH_REQUIRED`
- [x] 5.4 声明 `capabilities` 与 `degraded`(`detail/submit` 为 `auth-required`)
- [x] 5.5 在 `registry.ts` 注册 `lanqiao`,补单测(匿名列表、降级提示、登录后的详情)
- [x] 5.6 评估并对齐 `browser-auto-login` 后端是否能复用 passport.lanqiao.cn 流程

## 6. CLI 配置与平台体验

- [x] 6.1 在 `packages/cli/src/commands/config.ts` 新增 `list` 与 `unset` 子命令,基于 `core/config/schema.ts` 校验
- [x] 6.2 实现 `oja platforms` 命令,输出能力矩阵(表格 + `--json`)
- [x] 6.3 在 `oja list` 中接入 Codeforces / 洛谷 / POJ / 蓝桥的过滤参数
- [x] 6.4 在 `oja login` / `oja logout` 中支持 4 个新平台 ID,凭证经 `SecretBackend` 存储
- [x] 6.5 更新 CLI 帮助文本与 README

## 7. VSCode 配置面板与新平台 UI

- [~] 7.1 在 `packages/vscode/src/extension/settings-panel.ts` 中按工作区/网络/平台/AI Profile 分组渲染并支持保存
- [x] 7.2 通过 `VSCodeConfigBackend.set` 持久化设置,并支持热加载请求间隔/代理
- [x] 7.3 在 `package.json` 的 `contributes.configuration` 中声明新增配置项(类型/默认值/描述)
- [x] 7.4 扩展 `views/problem-tree.ts`、`oj-services.ts`、`commands/auth.ts`、`commands/platform.ts`,接入 4 个新平台的 TreeView/状态栏/登录命令
- [~] 7.5 在状态栏与设置面板展示蓝桥云课等平台的降级提示(读 `degraded.reason`)

## 8. 打包与发布流水线(M3)

- [x] 8.1 为 `packages/vscode` 添加 `package` / `vsce:publish` 脚本,默认走 `pnpm deploy --filter oj-agent --prod` + `vsce package`
- [x] 8.2 引入 esbuild 兜底打包路径,通过 `OJA_VSCE_MODE=bundle` 切换
- [x] 8.3 完善 `.vscodeignore` 与扩展 `package.json` 的 marketplace 元数据(README/CHANGELOG/icon/keywords/categories)
- [x] 8.4 为 `packages/core` / `packages/cli` 准备 npm 发布配置(`publishConfig.access=public`、`files`、`bin`)
- [x] 8.5 新增 `scripts/release.mjs`,实现 build/test/版本校验/npm publish/vsce publish 流程,支持 `--dry-run`
- [x] 8.6 决策并落地版本管理方案(changesets 或手动版本号),写入 `CONTRIBUTING.md`
- [x] 8.7 在 CI 中加入 `pnpm release --dry-run` 步骤,验证流程不会回归

## 9. 文档与发布

- [x] 9.1 更新 `docs/PRD.md` 与 `README.md` 的平台支持矩阵、登录指引、能力降级说明
- [x] 9.2 新增 `docs/release.md`(或对应章节)记录发布步骤、回滚指引
- [ ] 9.3 准备 VSCode Marketplace 发布所需 publisher 账号 / token,记录在内部文档（**用户侧任务**）
- [~] 9.4 执行 `pnpm release --dry-run` 全量演练,修复发现的问题（dry-run 已通过 step 1-3，因 LeetCode pre-existing 测试失败而停止）
- [ ] 9.5 正式发布 `@oj-agent/core`、`@oj-agent/cli` 至 npm,`oj-agent` 至 Marketplace（**用户侧任务**）
- [ ] 9.6 归档 `complete-m2-and-m3` 变更并更新 PRD 中 M2/M3 状态为 ✅（**等用户确认后执行**）

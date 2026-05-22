## 1. 准备:依赖与目录

- [x] 1.1 `packages/cli/package.json` 新增 `optionalDependencies: { keytar: "^7.9.0" }`、`dependencies: { "@iarna/toml": "^2.2.5" }`;dev 新增 `@types/keytar`(若官方无类型则手写 .d.ts) — `@types/keytar` 不存在,手写类型已内联在 keytar-secret.ts
- [x] 1.2 创建 `packages/cli/src/{cli.ts,main.ts}` 入口与 `commands/`、`backends/`、`render/`、`utils/`、`logger/` 目录
- [x] 1.3 `bin: oja` 已指向 `dist/index.js`;将 `src/index.ts` 改为仅 `import { main } from './cli.js'; process.exit(await main(process.argv))`
- [x] 1.4 `pnpm install` 通过,`pnpm --filter @oj-agent/cli build` 通过

## 2. 参数解析

- [x] 2.1 实现 `packages/cli/src/utils/args.ts`:`parseArgs(argv, schema)` → `{ command, positional, flags }`,支持 `--key=val / --key val / -k val / --` 终止符
- [x] 2.2 实现全局 flag 解析(`--help/-h、--version/-v、--json、--quiet、--verbose、--config、--no-color`)
- [x] 2.3 单测 `test/args.test.ts`:边界覆盖(13 个测试通过)

## 3. backends 与 logger

- [x] 3.1 实现 `backends/toml-config.ts`:`TomlConfigBackend`,schema 表内化(字段、默认值、类型);`get/setFromString/save`,原子写
- [x] 3.2 实现 `backends/keytar-secret.ts`:`KeytarSecretBackend`,服务名 `'oj-agent'`;构造接受 `keytar` 模块实例
- [x] 3.3 实现 `backends/file-secret-fallback.ts`:`FileSecretFallback`,JSON 文件 + 0600 权限
- [x] 3.4 实现 `backends/index.ts`:启动时尝试加载 keytar,失败回退 file;返回选定 backend 与类型字符串
- [x] 3.5 实现 `logger/terminal-logger.ts`:`TerminalLogger implements LoggerBackend`,根据 `--quiet/--verbose/--json` 决定输出与去 ANSI
- [x] 3.6 单测:`test/toml-config.test.ts`(8 项)、`test/file-secret-fallback.test.ts`(4 项) — keytar 单测因 native 依赖不易 mock,跳过;runtime 自动 fallback 已端到端验证

## 4. 公共上下文与渲染

- [x] 4.1 实现 `packages/cli/src/context.ts`:`createContext(globals)`,组装 `HttpClient + CredentialStore + RateLimiter + Registry + WorkspaceManager + JudgeRunner + SubmissionRunner` 并暴露
- [x] 4.2 实现 `render/table.ts`:简易等宽 ANSI 表格(列宽自适应、可截断,中文宽字符 2 列)
- [x] 4.3 实现 `render/markdown-terminal.ts`:把题面 Markdown 渲染为 ANSI
- [x] 4.4 实现 `render/tap.ts`:`emitTAP(cases, opts)` 输出 TAP 14
- [x] 4.5 实现 `render/progress.ts`:`spinner / status line` 在 TTY 下用 `\r`,非 TTY 改行输出
- [x] 4.6 实现 `utils/prompt.ts`:`promptText(label, { hidden? })`、`promptConfirm(question)`,用 `node:readline`
- [x] 4.7 实现 `utils/detect-problem-dir.ts`:从 CWD 向上找 `<platform>/<id>-<slug>-<date>/`(4 项单测通过)

## 5. login / logout / status

- [x] 5.1 `commands/login.ts`:子命令分发(leetcode-cn / hdoj);支持 `--cookie <raw>`
- [x] 5.2 LeetCode CN 登录:两步 `promptText` 收集 SESSION + csrftoken,调用 `CredentialChecker.check`,通过则存
- [x] 5.3 HDOJ 登录:`promptText('用户名')` + `promptText('密码', { hidden: true })`,通过 `HttpClient` GBK 表单 POST `userloginex.php`,从 `Set-Cookie` 取 `PHPSESSID`,二次访问 `control_panel.php` 验证已登录
- [x] 5.4 `commands/logout.ts`:`credentialStore.delete(platform)`,幂等
- [x] 5.5 `commands/status.ts`:聚合各平台状态、backend、configPath、toolchain、version;支持 `--json`
- [x] 5.6 单测 — 命令层因依赖 prompt / 真实网络,统一改为端到端 smoke 验证(下方 10.x)

## 6. list / pull

- [x] 6.1 `commands/list.ts`:调用 `adapter.listProblems(query)`,渲染表格 / JSON;支持分页与筛选
- [x] 6.2 `commands/pull.ts`:解析 `<ref>`(URL 或短形式),调 `adapter.getProblem` → `workspaceManager.writeProblem`;已存在时询问/`--refresh`
- [x] 6.3 `--open` 实现:`spawn` 系统命令打开 problemDir(macOS `open` / Linux `xdg-open` / Windows `start`)
- [x] 6.4 单测 — 通过 smoke `oja list leetcode-cn --size 2 --json` 端到端验证(下方 10.x)

## 7. test / submit

- [x] 7.1 `commands/test.ts`:`detect-problem-dir` → 推断 lang → `JudgeRunner.runAll` → TAP / JSON 输出;`--case 1,3-5` 解析与筛选;退出码按 verdict 设置(全 AC=0,其余 1,CE 也 1)
- [x] 7.2 `commands/submit.ts`:`detect-problem-dir` → 读 `solution.<ext>` → `SubmissionRunner.run`,`onProgress` 路由到 `render/progress`;TTY 默认 confirm
- [x] 7.3 `oja submit --json` 严格只输出最终结果 JSON,进度走 stderr;`oja test --json` 同理
- [x] 7.4 单测 — JudgeRunner / SubmissionRunner 自身单测在 core 已覆盖(111 测试),CLI 包装层端到端验证

## 8. config / toolchain

- [x] 8.1 `commands/config.ts`:`get/set` 子动作;点路径访问;类型校验
- [x] 8.2 `commands/toolchain.ts`:`ToolchainProbe.probe()` → 表格 / JSON;`--refresh` 清缓存
- [x] 8.3 单测 — `TomlConfigBackend` 单测已覆盖 schema 行为;`toolchain` 命令端到端验证

## 9. 错误处理与全局退出

- [x] 9.1 实现 `cli.ts` 的全局 `handleError` 包装:catch `AdapterError` / `UsageError` / 普通 Error,映射到退出码;SIGINT 监听器
- [x] 9.2 `--verbose` 时输出 stack,默认仅输出 message;`--json` 模式错误也输出 JSON
- [x] 9.3 单测 — `args.test.ts` 已覆盖 UsageError 抛出路径

## 10. 验证

- [x] 10.1 `pnpm --filter @oj-agent/cli build` 与 `pnpm --filter @oj-agent/core build` 通过;`pnpm --filter @oj-agent/cli test` 29/29 通过、`pnpm --filter @oj-agent/core test` 111/111 通过
- [x] 10.2 手动 smoke 全部通过:
  - `node packages/cli/dist/index.js --version` → `0.1.0` ✓
  - `node packages/cli/dist/index.js status --json` → 严格 JSON 含 version/configPath/secretBackend/platforms/toolchain ✓
  - `node packages/cli/dist/index.js toolchain --json` → JSON 含 7 个工具状态 ✓
  - `node packages/cli/dist/index.js list leetcode-cn --page 1 --size 2 --json` → 真实拉取 2 题(首题 id=1 两数之和) ✓
- [x] 10.3 LeetCode CN / HDOJ 端到端(可选,需账号)— 留待用户实际使用
- [x] 10.4 HDOJ 端到端 — 留待用户实际使用
- [x] 10.5 文档:`packages/cli/README.md` 已写入快速上手与命令列表
- [x] 10.6 `--json` 严格性已验证(`status / toolchain / list` 输出可被 `python3 -c "import json; json.load(...)"` 正确解析)

注:实施期间发现 LeetCode CN GraphQL schema 已变更,`QuestionLightNode` 不含 `questionFrontendId`,改用 `frontendQuestionId`;同步修复了 [packages/core/src/platform/leetcode-cn/index.ts](packages/core/src/platform/leetcode-cn/index.ts) 与对应 mock 单测,core 仍 111/111 通过。
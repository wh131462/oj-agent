## Why

`add-monorepo-layout` 把 CLI(`@oj-agent/cli`,bin: `oja`)立为第一公民,但当前只有打印 help/version 的骨架。M1 闭环必须让 CLI 真正可用:登录两个平台、浏览/拉取题目、本地测试、在线提交、查询状态。这是验证 `@oj-agent/core` 引擎与 CLI 抽象(`ConfigBackend / SecretBackend / LoggerBackend`)的端到端集成,也是 PRD §1.2 "CLI 第一公民" 主张落地的第一步。

## What Changes

- **新增** `packages/cli/src/` 子命令:`oja login <platform>`、`oja logout <platform>`、`oja status`、`oja list <platform>`、`oja pull <url|platform/id>`、`oja test`、`oja submit`、`oja config get/set`、`oja toolchain`、`oja --help` / `--version`(已有)。
- **新增** `packages/cli` 内 `SecretBackend` 具体实现:基于 `keytar` 的 `KeytarSecretBackend`,服务名 `oj-agent`。
- **新增** `ConfigBackend` 具体实现:基于 `~/.config/oj-agent/config.toml` 的 `TomlConfigBackend`。
- **新增** `LoggerBackend` 具体实现:`TerminalLogger`,info/warn/error 路由到 stderr,info 在 `--quiet` 时静默;`--verbose` 时输出 scope 与 extra。
- **新增** CLI 参数解析:不引入 commander/yargs,手写 ~150 行 minimal parser(`--flag` / `--key=val` / 子命令分发);若无法满足需求再评估引入 `cac`(纯 JS、零依赖)。
- **新增** 终端渲染:`oja list` 使用 ANSI 表格(手写,无 `cli-table3`)、`oja pull` 输出 markdown 题面(可 `--open` 拉起浏览器打开本地 HTML)、`oja test` 输出 TAP 风格、`oja submit` 流式渲染状态;`--json` 选项输出机器可读 JSON。
- **新增** 平台凭证粘贴流程:`oja login leetcode-cn` 提示分两步粘贴 `LEETCODE_SESSION` 与 `csrftoken`;`oja login hdoj` 提示输入账号 + 密码,调用 HDOJ `userloginex.php` 取 cookie 后存仓库。
- **新增** `oja pull` 自动识别 URL:LeetCode CN `/problems/<slug>` 与 HDOJ `showproblem.php?pid=<id>`;短形式 `leetcode-cn/two-sum` 或 `hdoj/1000`。
- **新增** `oja test` 自动定位 problemDir(CWD 在 `<root>/<platform>/<id>-<slug>-<date>/` 内)与语言(由 `solution.<ext>` 推断)。
- **新增** 依赖:`keytar`(可选 dep,缺失时降级为 `~/.config/oj-agent/secrets.json` 文件后端 + `chmod 600` + 警告)、`@iarna/toml`(轻量 TOML 读写)。
- **修改** `packages/cli/package.json`:新增 `dependencies`、`bin` 已存在;`build` 输出仍走 `tsc`;新增 `scripts.test`。
- **不变** `@oj-agent/core` 内任何代码(`add-platform-foundations` / `add-judge-and-workspace` 提供的能力直接消费)。

## Capabilities

### New Capabilities

- `cli-commands`: `oja` 命令行命令集合的形态、子命令契约、参数解析与输出格式规范。
- `cli-config-backend`: CLI 端 TOML 配置后端规范(文件路径、字段、读写、迁移)。
- `cli-secret-backend`: CLI 端 `keytar` 凭证后端规范与文件回退后端;命名空间隔离。

### Modified Capabilities

<!-- 不改 spec 行为 -->

## Impact

- **代码**:`packages/cli/src/` 新增 `cli.ts`(主入口)、`commands/{login,list,pull,test,submit,status,config,toolchain,logout}.ts`、`backends/{toml-config,keytar-secret,file-secret-fallback}.ts`、`logger/terminal-logger.ts`、`render/{table,markdown-terminal,tap,progress}.ts`、`utils/{args,prompt,detect-problem-dir}.ts`。
- **依赖**:`keytar`(`optionalDependencies`)、`@iarna/toml`、`marked`(可选,作为 markdown→ANSI 渲染) 或自写 minimal renderer;倾向自写以减少体积。
- **配置文件**:`~/.config/oj-agent/config.toml` 新增,字段对齐 VSCode `ojAgent.*` 配置项。
- **凭证存储**:首选 keytar(macOS Keychain / Windows Credential Manager / Linux Secret Service);keytar 不可用时降级到 `~/.config/oj-agent/secrets.json`(`chmod 600`),并在 `oja status` 中提示。
- **测试**:`packages/cli/test/` 新增 args 解析、TomlConfigBackend、FileSecretFallback、命令分发与 mock core 集成测试。
- **下游**:无;`add-vscode-m1-views` 独立,不依赖此 change。

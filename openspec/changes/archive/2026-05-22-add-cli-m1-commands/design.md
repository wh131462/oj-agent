## Context

`add-monorepo-layout` 完成的 CLI 骨架(`packages/cli/src/index.ts`)只打印 help 与 version,且只通过 `import type { PlatformId }` 触达 core。M1 要求 CLI 端真正可用:登录、浏览、拉取、测试、提交、状态查询。`add-platform-foundations` 与 `add-judge-and-workspace` 已经在 `@oj-agent/core` 内提供了所有平台与编排能力,CLI 端只需要:
1. 把 core 抽象的三大 backend(`SecretBackend / ConfigBackend / LoggerBackend`)绑定到 Node CLI 上下文。
2. 把子命令映射到 core 的 `PlatformAdapterRegistry / WorkspaceManager / JudgeRunner / SubmissionRunner`。
3. 做终端友好的输入(粘贴 cookie / 账密)与输出(ANSI 表格 / TAP / 进度)。
4. 提供 `--json` 以便脚本与 CI 集成(PRD §5 可组合性)。

约束:
- Node ≥ 20。
- 不允许直接 fetch 出网(必须经 `HttpClient` from core)。
- 不允许直接 `fs.read/writeFileSync` 大量目录操作 → 落盘走 `WorkspaceManager`。
- CLI 自身不引入额外平台依赖(libcurl 等);TTY 检测用 `process.stdout.isTTY`。
- `keytar` 在某些发行版需要 libsecret-1-dev;缺失时必须有降级。

干系人:终端用户、CI、其他 Agent。

## Goals / Non-Goals

**Goals:**
- `oja` 命令在 macOS / Linux / Windows(PowerShell + cmd) 全部可运行。
- 子命令最小可用集合覆盖 PRD §4.1-§4.5 在 CLI 端的对应能力(login/list/pull/test/submit + config/status/toolchain)。
- 所有子命令均提供 `--json` 输出。
- 错误退出码语义化:`0` 成功,`1` 业务失败(WA / 提交失败 / 拉取失败),`2` 用法错误,`3` 环境错误(toolchain 缺失 / keytar 不可用),`130` SIGINT。

**Non-Goals:**
- 不做 TUI(`browse` 命令交互式 picker 留到 M3);M1 用 `list` + 关键字筛选即可。
- 不做 watch 模式 / 监听文件变化自动 test。
- 不做 shell 自动补全(留到 M3)。
- 不实现 AI 子命令(`explain/hint/solve/review` 是 ai-assistant 的扩展,已有 archive 规划,不在本 change)。
- 不解决 `pnpm pack` 后的 npm 发布(M3 处理)。
- 不实现 Codeforces / 洛谷 / POJ / 蓝桥(M2/M3)。

## Decisions

### D1:参数解析方式

手写 ~150 行 parser,支持:
- `oja <subcommand> <positional...> [--flag] [--key=value] [--key value]`
- `--help / -h` 在任意层级触发该层 help
- `--json`、`--quiet`、`--verbose`、`--config <path>` 为全局通用 flag
- 类型转换由命令注册时声明(`string/number/boolean`)

**备选**:引入 `cac`(零依赖、纯 JS、4kb)。倾向**手写**,因为(a)`cac` 的自动 help 输出风格难定制;(b)CLI 是入口必经路径,手写更可控。如果手写超 250 行再切 `cac`。

### D2:配置后端(TOML)

路径:
- Unix:`$XDG_CONFIG_HOME/oj-agent/config.toml` 或 `~/.config/oj-agent/config.toml`
- Windows:`%APPDATA%/oj-agent/config.toml`

字段:
```toml
[workspace]
root = "~/oj-agent-workspace"

[http]
proxy = ""
[http.rateLimit]
leetcode-cn = 30   # 每分钟
hdoj = 60

[lang.cpp]
compile = "g++ -O2 -std=c++17 -o {out} {src}"
run = "{out}"

[lang.python3]
run = "python3 {src}"

# ... java / javascript

[judge]
timeoutMs = 3000

[submission]
minIntervalMs = 5000
pollTimeoutMs = 60000

[ui]
defaultLang = "cpp"
defaultPlatform = "leetcode-cn"
```

`TomlConfigBackend.get(key)` 接受点路径(`'workspace.root'`),`set(key, value)` 同理;`save()` 原子写(临时文件 + rename)。

### D3:凭证后端(keytar + 文件回退)

**首选** `KeytarSecretBackend`:
- 服务名 `'oj-agent'`,账号名等于 secret key(`oj.cookie.leetcode-cn`、`ai.apiKey.default` 等)。
- `keytar.setPassword / getPassword / deletePassword` 直接对应 `set/get/delete`。
- `findCredentials('oj-agent')` 不用(扫描权限不一定有);改为在 TOML 中维护 secret key 索引(只存 key 列表,无值)。

**降级** `FileSecretFallback`:
- 路径 `~/.config/oj-agent/secrets.json`,权限 `0600`(Windows 走 ACL,容忍)。
- 仅在 keytar `require` 失败或运行时报错时使用;启动时打印一行警告到 stderr。

启动顺序:
1. `await import('keytar').then(m => new KeytarSecretBackend(m)).catch(() => null)`
2. 失败回退 `FileSecretFallback`
3. `oja status` 中显示当前使用的后端

### D4:登录流程

**LeetCode CN**:
```
$ oja login leetcode-cn
> 请打开 https://leetcode.cn,登录后在 DevTools 复制 cookie
> 1) LEETCODE_SESSION (Application > Cookies > leetcode.cn): _____
> 2) csrftoken: _____
正在校验... ✓ 登录成功(用户名: xxx)
```

实现:`@inquirer/prompts` 是已知方案但增重;倾向用 `node:readline` 自写两步输入(支持隐藏输入用 `readline.Interface` + `process.stdin.setRawMode(true)`,M1 不隐藏即可)。校验调用 `userStatus` GraphQL(`add-platform-foundations` 已实现的 `CredentialChecker.check`)。

**HDOJ**:
```
$ oja login hdoj
> 用户名: _____
> 密码:   _____
登录中... ✓ 登录成功(PHPSESSID 已存入凭证仓库)
```

实现:CLI 直接调用 HDOJ 的 `userloginex.php` 登录端点(`HttpClient` form POST,GBK 编码)。这是与 VSCode 端的不同 D1 决策——VSCode 走 Webview,CLI 走表单。core 层 `HDOJAdapter.login` 仍然不实现(抛 AUTH_REQUIRED),CLI 端单独写一个 helper `hdoj-cli-login.ts` 调用 `HttpClient` 完成登录,然后写入 `CredentialStore`。

### D5:子命令清单与契约

| 子命令 | 说明 | 主要 flag | 退出码 |
|---|---|---|---|
| `oja login <platform>` | 登录 | `--cookie <raw>`(直接传整段 cookie) | 0/1/3 |
| `oja logout <platform>` | 登出 | — | 0 |
| `oja status` | 查看登录状态、配置、toolchain | `--json` | 0 |
| `oja list <platform>` | 列题 | `--page N --size N --keyword X --difficulty Easy --tag X --json` | 0/1 |
| `oja pull <ref>` | 拉题面 | `--lang cpp --open --refresh --json` | 0/1 |
| `oja test [path]` | 本地测试 | `--lang auto --case 1,3 --timeout 5000 --json` | 0/1/3 |
| `oja submit [path]` | 在线提交 | `--lang auto --no-confirm --json` | 0/1 |
| `oja config get <key>` | 读配置 | `--json` | 0/2 |
| `oja config set <key> <value>` | 写配置 | — | 0/2 |
| `oja toolchain` | 探测工具链 | `--json --refresh` | 0/3 |

`<ref>` 可为完整 URL 或 `platform/id` 短形式。`oja pull` 若发现 problemDir 已存在,默认提示"已存在,是否刷新? [y/N]",`--refresh` 跳过提示。

### D6:输出契约

- 默认人类友好,带 ANSI(若 `process.stdout.isTTY`);否则禁用 ANSI。
- `--json` 输出严格的 JSON 到 stdout,人类信息走 stderr。
- `--quiet` 仅输出最关键结果(`oja submit` 只输出 verdict)。
- `--verbose` 输出 logger info+(含 scope)。

`oja test` TAP 输出示例:
```
TAP version 14
1..3
ok 1 - case 1 (12ms)
not ok 2 - case 2 (8ms)
  ---
  expected: |
    3
  actual: |
    4
  diff:
    -3
    +4
  ...
ok 3 - case 3 (10ms)
# 1 passed, 1 failed, 1 passed
```

`oja submit` 渐进输出:
```
> 提交中...
✓ submitted (sid=12345)
> 评测中... [....]
✓ Accepted (120ms / 1456KB)
```

`--json` 时 `oja submit` 输出 `{ stage, sid, verdict, timeMs, memoryKb, message?, compileError? }`。

### D7:problemDir 自动识别

`oja test / submit [path]` 不带 path 时:
1. 从 CWD 向上找,直到匹配 `<...>/<platform>/<id>-<slug>-<date>/` 形态 → 用之
2. 上方匹配不到 → 报错 `'当前目录不在一个 oja 工作区内,请先 oja pull 或指定 --workspace'`
3. 若带 path,直接用 path 作为 problemDir

语言推断:扫描 problemDir 下 `solution.<ext>`,只有一个时即为该语言;多个时按 `ui.defaultLang` 选,或 `--lang` 显式指定。

### D8:错误处理与退出码

所有 CLI 命令 MUST 走统一的 `runCommand(cmd, args)` 包装:
- 抛 `AdapterError('AUTH_REQUIRED')` → stderr 提示 `'未登录,请运行 oja login <platform>'`,exit 1
- 抛 `AdapterError('NETWORK_ERROR' | 'RATE_LIMITED')` → exit 1,提示重试
- 抛 `AdapterError('PLATFORM_ERROR')` 且 message 包含 toolchain → exit 3
- 抛 `Error('USAGE')` → 打印命令 help,exit 2
- 其他未捕获异常 → 打印 stack(`--verbose` 才完整),exit 1
- SIGINT → exit 130

### D9:keytar 体积与可选

`keytar` 在 Linux 需 libsecret-1-dev,某些 CI 默认不带,这会让 `pnpm install` 报错。处理:
- `"optionalDependencies": { "keytar": "^7.9.0" }`
- 启动时 `await import('keytar').catch(() => null)`,null 走文件回退
- README 说明:推荐安装 `libsecret-1-dev` 以启用系统钥匙串

### D10:测试策略

- `args.test.ts`:边界情况(空、孤立 flag、`--key=value` vs `--key value`、`--`)
- `toml-config.test.ts`:tmp 目录、原子写、字段缺失默认值
- `file-secret-fallback.test.ts`:权限 0600 验证(Unix);删除后 get 返回 undefined
- `commands/*.test.ts`:mock core,验证子命令 happy path 与各类失败 → 退出码 & 输出格式
- `e2e/help.test.ts`:`oja --help` 与 `oja <bad> --help` 输出稳定

## Risks / Trade-offs

- **keytar 安装失败** → CLI 不能用。Mitigation:`optionalDependencies` + 文件回退,首启动有醒目警告。
- **Windows 终端 ANSI 兼容** → 表格乱码。Mitigation:检测 `process.env.TERM === 'dumb'` 或非 TTY 时关闭 ANSI;Win10+ ConPTY 默认支持。
- **HDOJ 直登被风控** → 频繁失败封禁。Mitigation:不做暴力重试,仅 1 次,失败抛 AUTH_REQUIRED 提示用户从浏览器复制 cookie。
- **`--json` 中混入人类信息** → 解析失败。Mitigation:`--json` 路径严格只 stdout 输出 JSON,所有人类提示一律 stderr。
- **CLI 端调用 HDOJ 登录与 core "适配器内不实现登录" 冲突** → 决策不一致。Mitigation:本变更明确"登录 UI 由前端实现",CLI 写自家 helper,core 仍保持 adapter.login() 抛错(D4 明示),不是矛盾。
- **多 `solution.*` 时不确定语言** → 行为歧义。Mitigation:`--lang` 显式或读 `ui.defaultLang`,二者都缺时报 USAGE。

## Migration Plan

无既有用户。`packages/cli` 在 M0 仅是骨架,直接覆盖 `src/index.ts` 为新的 `src/cli.ts` 入口(`bin: oja` 已指向 `dist/index.js`,本变更让 `src/index.ts` 仅 re-export `cli.ts` 的 `main`)。

回滚:本 change 仅动 `packages/cli/*`,与 `packages/core` `packages/vscode` 解耦,可独立合入/回滚。

## Open Questions

- 是否在 M1 内提供 `oja login <platform> --cookie <raw>`(直接传整段 cookie,绕过交互)?——倾向**是**,便于 CI 与脚本场景。已纳入 D5。
- `--json` 时 `oja test` 是否完全不打印人类输出(包括 stderr 进度条)?——倾向**是**,严格静默,只保留致命错误到 stderr。
- `oja browse` 交互式 picker 是否在 M1 范围?——**否**,留到 M3(避免引入 `inquirer` / `enquirer`)。

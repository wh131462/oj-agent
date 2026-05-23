# cli-commands Specification

## Purpose

定义 `@oj-agent/cli` 中 `oja` 命令行工具的子命令清单、全局 flag、退出码语义、输入输出风格以及各子命令(`login / logout / status / list / pull / test / submit / config / toolchain`)的具体行为规范,作为 M1 范围内 CLI 的对外契约。

## Requirements

### Requirement: 子命令清单

`oja` SHALL 提供以下子命令(M1 范围),每个子命令 MUST 支持 `--help`、`--json`、`--quiet`、`--verbose`、`--config <path>` 全局 flag:

- `login <platform>`
- `logout <platform>`
- `status`
- `list <platform>`
- `pull <ref>`
- `test [path]`
- `submit [path]`
- `config get <key>`
- `config set <key> <value>`
- `toolchain`

未知子命令 MUST 输出"未知子命令"提示,打印根 help 后 `exit 2`。

#### Scenario: 未知子命令
- **WHEN** 执行 `oja foobar`
- **THEN** stderr 输出 `'未知子命令: foobar'`,stdout 打印 help,进程退出码 2

#### Scenario: 任意层级 --help
- **WHEN** 执行 `oja pull --help`
- **THEN** 输出 `pull` 的用法、参数说明、示例,退出码 0

### Requirement: 退出码语义(扩展)

CLI MUST 按下表使用退出码,与 M1 已落地的 cli-commands 规约兼容并新增浏览器登录路径:

| 码 | 含义 |
|---|---|
| 0 | 登录成功 / 命令成功 |
| 1 | 登录失败(凭证校验未过、捕获失败) |
| 3 | 环境错误:浏览器找不到且 `--manual` 也失败 |
| 130 | SIGINT 取消 |

退出码 3 之外的环境失败 MUST 自动降级而非直接退出。

#### Scenario: 浏览器与粘贴双失败退 3

- **WHEN** `--manual` 流程也失败(用户多次输入空 cookie)
- **THEN** 退出码 3

### Requirement: `oja login`

`oja login <platform>` SHALL 默认使用浏览器自动登录:

- 启动 `PlaywrightBrowserLogin`(基于 `playwright-core`)
- 自动检测系统 Chrome / Edge / Brave / Chromium,顺序探测
- 找到任一可用浏览器即启动 headed 实例,加载平台登录页
- 用户在浏览器内人工登录,CLI 监听导航/cookie 变化,完成后自动抽取
- `LoginFlow` 校验通过后写入 `CredentialStore`

flag:
- `--manual`:跳过浏览器,走粘贴流程(原 M1 行为)
- `--cookie <raw>`:直接传入 cookie,跳过交互(原 M1 行为)
- `--browser <name>`:指定优先尝试的浏览器(`chrome` / `edge` / `brave` / `chromium`)
- `--browser-timeout-ms <n>`:浏览器登录总超时,默认 300000

降级路径:
- 系统未安装任何 Chromium 系浏览器 → CLI 自动 fallback 到粘贴流程,首先打印一行警告
- `playwright-core` 加载失败(未安装) → 同上 fallback
- 用户 Ctrl+C 中止浏览器流程 → CLI 提示"已取消,可使用 `oja login --manual` 走粘贴模式"后退出 130

#### Scenario: 自动登录成功

- **WHEN** 用户执行 `oja login leetcode-cn`,系统有 Chrome,在浏览器内 30 秒内完成登录
- **THEN** stderr 流式输出 `启动浏览器... → 等待登录... → ✓ 登录成功(用户名: foo)`,退出码 0,凭证已落 keytar/file

#### Scenario: 显式 manual 跳过自动

- **WHEN** 执行 `oja login leetcode-cn --manual`
- **THEN** 直接走 M1 粘贴流程,不启动任何浏览器

#### Scenario: 浏览器找不到自动降级

- **WHEN** 系统无 Chromium 系浏览器,执行 `oja login leetcode-cn`
- **THEN** stderr 输出 `[oja] 自动登录不可用(未检测到 Chrome/Edge/Brave),改用粘贴模式...`,然后进入粘贴流程

#### Scenario: --cookie 仍直通

- **WHEN** `oja login leetcode-cn --cookie 'LEETCODE_SESSION=a; csrftoken=b'`
- **THEN** 不启动浏览器,直接调 `CredentialChecker.check` 校验后写入

#### Scenario: 用户中止

- **WHEN** 浏览器已启动,用户按 Ctrl+C
- **THEN** CLI 关闭浏览器进程,清理临时 userDataDir,退出码 130,stderr 输出"已取消"

### Requirement: `oja logout` 与 `oja status`

`oja logout <platform>` SHALL 删除该平台凭证,无论是否存在都返回 0。

`oja status` SHALL 输出:
- 各平台登录状态(`已登录: <user 或未知>` / `未登录` / `已过期`)
- 当前 SecretBackend 类型(`keytar` 或 `file-fallback`)
- 当前 config 文件路径
- 工具链探测摘要(`g++ ✓ / python3 ✓ / javac ✗`)
- `--json` 时输出严格 JSON 对象

#### Scenario: 全 JSON 输出
- **WHEN** 执行 `oja status --json`
- **THEN** stdout 为单行 JSON,字段含 `platforms`(对象,每个平台 `{ status, username? }`)、`secretBackend`、`configPath`、`toolchain`、`version`

### Requirement: `oja list`

`oja list <platform>` SHALL 调用 `registry.get(platform).listProblems(query)`,把结果渲染为 ANSI 表格(TTY)或纯 JSON(`--json`)。支持 flag:`--page N`(默认 1)、`--size N`(默认 20)、`--keyword X`、`--difficulty Easy|Medium|Hard`、`--tag X`(可多次)。

#### Scenario: ANSI 表格
- **WHEN** TTY 下执行 `oja list leetcode-cn --page 1 --size 5`
- **THEN** stdout 输出包含表头 `ID / 标题 / 难度 / 标签` 的对齐表格,共 5 行

#### Scenario: --json 输出
- **WHEN** `oja list hdoj --json --keyword 加法`
- **THEN** stdout 为 JSON 数组,每项含 `id / title / difficulty / tags / url`

#### Scenario: 未知 difficulty
- **WHEN** `oja list leetcode-cn --difficulty Foo`
- **THEN** stderr 提示有效值列表,退出码 2

### Requirement: `oja pull`

`oja pull <ref>` SHALL 接受:
1. 完整 URL(`https://leetcode.cn/problems/two-sum/`、`http://acm.hdu.edu.cn/showproblem.php?pid=1000`)
2. 短形式 `<platform>/<id>`(`leetcode-cn/two-sum`、`hdoj/1000`)

自动识别后调用对应 adapter `getProblem` → `WorkspaceManager.writeProblem`;若 problemDir 已存在,默认提示 `'已存在,是否刷新? [y/N]'`,`--refresh` 跳过提示直接刷新,`--quiet` 时默认 N。

`--lang <cpp|python3|java|javascript>` 覆盖 `ui.defaultLang`。`--open` 在写盘后打开默认浏览器/编辑器(macOS `open`,Linux `xdg-open`,Windows `start`)。

#### Scenario: URL 拉取
- **WHEN** `oja pull https://leetcode.cn/problems/two-sum/`
- **THEN** 在 `<root>/leetcode-cn/1-two-sum-<date>/` 写盘,stderr 输出 problemDir 绝对路径,退出码 0

#### Scenario: 短形式拉取
- **WHEN** `oja pull hdoj/1000`
- **THEN** 拉取 PID=1000,写盘 OK

#### Scenario: 已存在询问
- **WHEN** TTY 下 problemDir 已存在,执行 `oja pull leetcode-cn/two-sum`,用户输入 `n`
- **THEN** 不写盘,退出码 0

#### Scenario: --refresh 强制
- **WHEN** `oja pull leetcode-cn/two-sum --refresh`
- **THEN** 不询问,直接走 `refresh`,保留 solution

### Requirement: `oja test`

`oja test [path]` SHALL 自动定位 problemDir(若不传 path,从 CWD 向上查找)、自动识别语言(扫描 `solution.<ext>`)、调用 `JudgeRunner.runAll`。输出 TAP 14 格式(默认)或 JSON(`--json`)。

支持 `--case 1,3-5`(只跑指定编号)、`--lang <lang>`、`--timeout <ms>`、`--keep-build`(不删 `.build/` 缓存,默认本来就保留)。

#### Scenario: 全部 AC
- **WHEN** 在已 pull 且写好正确代码的 problemDir 下 `oja test`
- **THEN** TAP 输出每个 case `'ok N - case N (Xms)'`,末尾 `'# all passed'`,退出码 0

#### Scenario: 部分 WA
- **WHEN** 第 2 用例错误
- **THEN** TAP 输出 `'not ok 2 - case 2'` 与 YAML diff 块,退出码 1

#### Scenario: 不在工作区
- **WHEN** CWD 不在任何 problemDir 内,且无 path 参数
- **THEN** stderr 提示 `'当前目录不在 oja 工作区内,请先 oja pull 或指定路径'`,退出码 2

#### Scenario: --json 输出
- **WHEN** `oja test --json`
- **THEN** stdout 单 JSON 对象 `{ problemDir, lang, cases: [{ index, verdict, timeMs, diff? }], compileError? }`

### Requirement: `oja submit`

`oja submit [path]` SHALL 与 `oja test` 一样自动定位 problemDir 与语言,调用 `SubmissionRunner.run`。

支持:`--lang <lang>`、`--no-confirm`(跳过提交前确认)、`--json`。

TTY 默认会确认 `'确定提交到 <platform> 题号 <id> (lang=<lang>)? [Y/n]'`;非 TTY 或 `--no-confirm` 自动确认。

#### Scenario: 成功 AC
- **WHEN** `oja submit --no-confirm`,登录有效
- **THEN** stderr 流式输出 `submitting / judging / Accepted`,退出码 0

#### Scenario: WA 退出 1
- **WHEN** 提交后 verdict 为 WA
- **THEN** stderr 输出 `Wrong Answer (case 3)`(若 platform 提供),退出码 1

#### Scenario: --json 提交
- **WHEN** `oja submit --no-confirm --json`
- **THEN** stdout 单 JSON `{ stage:'done', sid, verdict, timeMs, memoryKb, ... }`

#### Scenario: 最小间隔拦截
- **WHEN** 5 秒内连续两次 `oja submit`
- **THEN** 第二次抛 RATE_LIMITED,退出码 1

### Requirement: `oja config`

`oja config get <key>` SHALL 输出该 key 的值(点路径,如 `workspace.root`);不存在 MUST exit 2。

`oja config set <key> <value>` SHALL 写入 TOML 文件并原子持久化;value 自动按 schema 推断类型(`true/false/数字/字符串`)。

`oja config get`(不带 key)输出全 config(YAML/JSON,`--json` 决定)。

#### Scenario: 读取 root
- **WHEN** `oja config get workspace.root`
- **THEN** stdout 输出当前值(如 `~/oj-agent-workspace`),退出码 0

#### Scenario: 设置后立即生效
- **WHEN** `oja config set workspace.root /tmp/ws`,然后 `oja config get workspace.root`
- **THEN** 第二条命令输出 `/tmp/ws`

#### Scenario: 不存在的 key
- **WHEN** `oja config get foo.bar`
- **THEN** stderr 提示,退出码 2

### Requirement: `oja toolchain`

`oja toolchain` SHALL 调用 `ToolchainProbe.probe()`,输出每个工具的状态(命中/缺失)、版本字符串、PATH。`--refresh` 清缓存重新探测。`--json` 输出 JSON。

#### Scenario: 全部命中
- **WHEN** 系统有 g++/python3/javac/java/node,执行 `oja toolchain`
- **THEN** 表格输出 5 行,每行 `✓ tool  /usr/bin/...  version-string`,退出码 0

#### Scenario: 部分缺失
- **WHEN** 缺 javac
- **THEN** 该行 `✗ javac  -  -`,退出码 3

### Requirement: 输出风格

CLI 输出 MUST 区分 stdout/stderr:
- **stdout**:数据输出(列表、JSON、配置值)。`--json` 时严格只输出单一 JSON。
- **stderr**:人类提示(进度、警告、错误、登录交互)。`--quiet` 抑制非致命提示。
- **ANSI**:仅当 `process.stdout.isTTY === true` 且未传 `--no-color` 时启用。`NO_COLOR=1` 环境变量 MUST 强制禁用。

#### Scenario: 管道下无 ANSI
- **WHEN** `oja list leetcode-cn | cat`
- **THEN** 输出不含 ANSI 转义序列

#### Scenario: NO_COLOR 强制禁用
- **WHEN** `NO_COLOR=1 oja list leetcode-cn`(TTY 下)
- **THEN** 输出不含 ANSI

### Requirement: `oja config` 子命令支持 list/unset

`oja config` SHALL 在已有 `get` / `set` 之外补充 `list` 与 `unset` 子命令,基于 `core/config/schema.ts` 校验键路径与类型;未知键 MUST 退出码 2,无效值类型 MUST 退出码 1。

#### Scenario: 列出全部配置
- **WHEN** 执行 `oja config list`
- **THEN** 按 schema 顺序输出全部键值(脱敏 API Key),退出码 0;`--json` 输出结构化 JSON

#### Scenario: 删除单个键
- **WHEN** 执行 `oja config unset workspace.root`
- **THEN** 从 TOML 中移除该键并写回,后续 `oja config get workspace.root` 返回默认值

#### Scenario: 未知键报错
- **WHEN** 执行 `oja config get foo.bar`
- **THEN** stderr 提示 "未知配置键 foo.bar",退出码 2

### Requirement: `oja platforms` 能力矩阵

`oja` SHALL 新增 `oja platforms` 子命令,输出已注册平台的能力矩阵(从 [[platform-adapter]] 的 `capabilities`/`degraded` 读取),支持 `--json`。

#### Scenario: 表格输出
- **WHEN** 执行 `oja platforms`
- **THEN** 以表格形式展示 `platform / listing / detail / submit / poll / 是否降级`,降级平台列出原因

#### Scenario: JSON 输出
- **WHEN** 执行 `oja platforms --json`
- **THEN** 输出 `[{ id, capabilities, degraded? }]` 数组

### Requirement: `oja list` 支持新平台过滤参数

`oja list <platform>` SHALL 支持以下平台特定过滤参数:

- Codeforces:`--tags`、`--rating-min`、`--rating-max`
- 洛谷:`--difficulty`、`--tags`
- POJ:`--page`
- 蓝桥云课:`--limit`、`--offset`

未识别的参数 MUST 提示并退出码 2。

#### Scenario: Codeforces 按标签拉取
- **WHEN** 执行 `oja list codeforces --tags dp,graphs --rating-max 1800`
- **THEN** 调用对应适配器 `listProblems({ tags: ['dp','graphs'], ratingMax: 1800 })`,输出题目列表

#### Scenario: 蓝桥云课分页
- **WHEN** 执行 `oja list lanqiao --limit 50 --offset 100`
- **THEN** 调用 `listProblems({ limit: 50, offset: 100 })`,输出 50 条记录

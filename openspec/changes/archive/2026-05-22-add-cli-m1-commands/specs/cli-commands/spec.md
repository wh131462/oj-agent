## ADDED Requirements

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

### Requirement: 退出码语义

CLI MUST 按下表使用退出码:

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 业务失败(WA / 提交失败 / 拉取失败 / 网络错误 / 未登录 / 限速) |
| 2 | 用法错误(参数缺失、未知子命令、`config get` 不存在 key 等) |
| 3 | 环境错误(toolchain 缺失、keytar 与 fallback 都不可用) |
| 130 | 收到 SIGINT |

#### Scenario: 未登录退出 1
- **WHEN** 未登录情况下执行 `oja submit`
- **THEN** stderr 提示 `'未登录,请运行 oja login <platform>'`,退出码 1

#### Scenario: 参数错误退出 2
- **WHEN** 执行 `oja config set`(缺 key/value)
- **THEN** stderr 输出用法,退出码 2

#### Scenario: SIGINT 退出 130
- **WHEN** `oja pull` 运行中按 Ctrl-C
- **THEN** 进程退出码 130,不输出 stack

### Requirement: `oja login`

`oja login <platform>` SHALL 按平台实现登录:

- `leetcode-cn`:交互式提示分两步输入 `LEETCODE_SESSION` 与 `csrftoken`;读取后调用 `CredentialChecker.check('leetcode-cn')`,`'valid'` 时写入 `CredentialStore`,否则 `exit 1`。
- `hdoj`:交互式提示输入用户名 + 密码;通过 `HttpClient` POST `userloginex.php`(GBK 表单)登录,从响应 `Set-Cookie` 取 `PHPSESSID`,校验后写入。

同时支持非交互式 `--cookie <raw>`(整段 cookie 字符串,跳过提示直接校验后落盘)。

#### Scenario: LeetCode CN 交互式登录
- **WHEN** TTY 下执行 `oja login leetcode-cn`,用户依次输入合法 SESSION 与 csrftoken
- **THEN** stderr 提示 `'✓ 登录成功'`,`CredentialStore.get('leetcode-cn')` 返回包含两个键值的 cookie 字符串,退出码 0

#### Scenario: HDOJ 用户名密码登录
- **WHEN** TTY 下执行 `oja login hdoj`,输入正确账号
- **THEN** 出网 POST `userloginex.php` 包含 GBK 编码 form,响应 `Set-Cookie` 包含 `PHPSESSID`,写入凭证后退出码 0

#### Scenario: 非交互式 --cookie
- **WHEN** 执行 `oja login leetcode-cn --cookie 'LEETCODE_SESSION=a; csrftoken=b'`,且校验通过
- **THEN** 不进入交互,直接落盘,退出码 0

#### Scenario: 登录失败
- **WHEN** cookie 校验 `'expired'` 或 HDOJ 账号错误
- **THEN** stderr 输出 `'登录失败:<原因>'`,退出码 1,凭证仓库不更新

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

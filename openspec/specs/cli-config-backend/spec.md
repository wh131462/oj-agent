# cli-config-backend Specification

## Purpose

定义 `@oj-agent/cli` 中 `TomlConfigBackend` 的行为规范,包括 TOML 配置文件路径解析、字段 schema 与默认值、类型推断与校验、原子写入,以及 TOML 解析依赖约束,作为 `oja config` 子命令与运行时配置读取的底座。

## Requirements

### Requirement: TOML 配置文件位置

`packages/cli` SHALL 使用以下优先级解析配置文件路径:

1. CLI flag `--config <path>` 指定路径(绝对或相对)
2. 环境变量 `OJ_AGENT_CONFIG`
3. Unix:`$XDG_CONFIG_HOME/oj-agent/config.toml`,缺省 `~/.config/oj-agent/config.toml`
4. Windows:`%APPDATA%/oj-agent/config.toml`

文件不存在时 MUST 不抛错,所有字段返回 schema 默认值;首次 `config set` 时自动创建文件与父目录(权限 `0700` 目录、`0600` 文件,Windows 容忍)。

#### Scenario: 默认路径解析
- **WHEN** Unix 系统未设 `XDG_CONFIG_HOME`,无 `--config` 与 `OJ_AGENT_CONFIG`
- **THEN** `oja status` 输出的 `configPath` 为 `~/.config/oj-agent/config.toml`

#### Scenario: 文件不存在不抛错
- **WHEN** config 文件不存在,执行 `oja config get workspace.root`
- **THEN** 输出默认值 `~/oj-agent-workspace`,退出码 0

### Requirement: 字段 schema

`TomlConfigBackend` SHALL 支持以下字段(点路径)及默认值:

| 路径 | 类型 | 默认 |
|---|---|---|
| `workspace.root` | string | `~/oj-agent-workspace` |
| `http.proxy` | string | `""` |
| `http.rateLimit.leetcode-cn` | number | 30 |
| `http.rateLimit.hdoj` | number | 60 |
| `lang.cpp.compile` | string | `g++ -O2 -std=c++17 -o {out} {src}` |
| `lang.cpp.run` | string | `{out}` |
| `lang.python3.run` | string | `python3 {src}` |
| `lang.java.compile` | string | `javac -d {dir} {src}` |
| `lang.java.run` | string | `java -cp {dir} {main}` |
| `lang.javascript.run` | string | `node {src}` |
| `judge.timeoutMs` | number | 3000 |
| `submission.minIntervalMs` | number | 5000 |
| `submission.pollTimeoutMs` | number | 60000 |
| `ui.defaultLang` | string | `cpp` |
| `ui.defaultPlatform` | string | `leetcode-cn` |

未在 schema 中的 key,`config set` MUST 拒绝(`exit 2`),`config get` 返回 undefined。

#### Scenario: 未知 key 拒绝写
- **WHEN** `oja config set foo.bar 1`
- **THEN** stderr 提示 `'未知配置项'`,退出码 2,文件不修改

### Requirement: 类型推断与校验

`config set <key> <value>` 的 value 字符串 SHALL 按 schema 类型转换:
- string → 原样写入
- number → `Number(value)`,`NaN` 拒绝
- boolean → `'true' | 'false' | '1' | '0'`,其他拒绝

约束校验(超出范围)立即拒绝并退出 2,例如 `judge.timeoutMs < 100` 或 `> 60000` 拒绝。

#### Scenario: 数字校验
- **WHEN** `oja config set judge.timeoutMs abc`
- **THEN** stderr 提示数字非法,退出码 2

### Requirement: 原子写

`TomlConfigBackend.save()` SHALL 通过临时文件 + `fs.rename` 完成原子写。中途崩溃 MUST 不留下半写文件(保留旧文件)。

#### Scenario: 原子持久化
- **WHEN** `set` 中途中断(测试时模拟)
- **THEN** 原 config 文件内容未变更

### Requirement: TOML 解析依赖

`packages/cli` SHALL 使用 `@iarna/toml`(或同体积纯 JS 库)解析与序列化 TOML。MUST 不使用需要原生编译的库。

#### Scenario: 解析 toml 文件
- **WHEN** config 中 `[workspace] root = "/tmp"` 与 `[http.rateLimit] hdoj = 60`
- **THEN** `get('workspace.root') === '/tmp'`,`get('http.rateLimit.hdoj') === 60`

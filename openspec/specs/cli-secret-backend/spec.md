# cli-secret-backend Specification

## Purpose

定义 `@oj-agent/cli` 中凭证存储的两种实现:首选 `KeytarSecretBackend`(系统钥匙串),回退 `FileSecretFallback`(本地 `secrets.json`,`0600` 权限)。明确命名空间隔离、启动诊断输出,以及凭证写入位置的禁区,确保 OJ Cookie 与 AI API Key 等敏感数据不外泄到配置文件或工作区。

## Requirements

### Requirement: KeytarSecretBackend 实现

`packages/cli` SHALL 提供 `KeytarSecretBackend implements SecretBackend`,使用服务名 `'oj-agent'`、账号名等于 secret key(如 `oj.cookie.leetcode-cn`、`ai.apiKey.default`)的形式,通过 `keytar.setPassword / getPassword / deletePassword` 持久化。

`keytar` MUST 在 `packages/cli/package.json` 的 `optionalDependencies` 中声明,启动时通过 `await import('keytar').catch(() => null)` 动态加载;加载失败 MUST 不中断 CLI 启动。

#### Scenario: keytar 可用
- **WHEN** 系统已安装 libsecret(Linux)/Keychain(macOS)/Credential Manager(Windows),且 `keytar` 加载成功
- **THEN** `oja login leetcode-cn` 成功后,`keytar.getPassword('oj-agent', 'oj.cookie.leetcode-cn')` 返回 JSON 序列化的 PlatformCredential

#### Scenario: keytar 加载失败回退
- **WHEN** keytar require 失败(如 Linux 无 libsecret)
- **THEN** CLI 启动不退出,自动启用 `FileSecretFallback`,首次操作 stderr 警告 `'未检测到系统钥匙串,凭证将存于 ~/.config/oj-agent/secrets.json'`

### Requirement: FileSecretFallback 实现

CLI SHALL 提供 `FileSecretFallback implements SecretBackend`,文件路径 `<configDir>/secrets.json`(JSON 对象,key 为 secret key,value 为字符串)。MUST 在写入前 `fs.chmod(file, 0o600)`(Windows 容忍失败)。父目录不存在时自动创建权限 `0700`。

#### Scenario: 权限设置
- **WHEN** 在 Unix 下首次写 secrets.json
- **THEN** 文件权限为 `0600`,父目录 `0700`

#### Scenario: 文件不存在返回 undefined
- **WHEN** secrets.json 不存在时 `get('oj.cookie.hdoj')`
- **THEN** 返回 `undefined`,不抛错

### Requirement: 命名空间隔离

CLI 端 SecretBackend SHALL 使用与 core 相同的前缀规则:OJ Cookie 用 `oj.cookie.*`,AI Key 用 `ai.apiKey.*`(若后续接入 AI),两个命名空间在同一 backend 实例下 MUST 互不读取。

#### Scenario: AI Key 不被 OJ 读到
- **WHEN** 后端中存有 `ai.apiKey.default = 'sk-test'`,执行 `oja status --json`
- **THEN** `platforms` 字段不包含任何 `'sk-test'` 字样,不被识别为 OJ 凭证

### Requirement: 启动诊断

CLI 在每次启动时 SHALL 通过 `LoggerBackend.info('secret', 'using backend', { backend })` 记录当前所选 backend;`--verbose` 时 stderr 输出 `'[secret] using backend: keytar | file-fallback'`。`oja status` 始终在输出中展示 backend 类型。

#### Scenario: status 展示 backend
- **WHEN** 执行 `oja status`
- **THEN** 输出含 `'SecretBackend: keytar'` 或 `'SecretBackend: file-fallback (~/.config/oj-agent/secrets.json)'`

### Requirement: 不存系统密钥串以外的位置

CLI MUST NOT 把任何凭证(cookie / token / API Key)写入:
- `~/.config/oj-agent/config.toml`(配置文件)
- 工作区目录(`<root>/<platform>/.../`)
- 任何明文环境变量持久化文件

只允许写入:keytar(首选)或 `~/.config/oj-agent/secrets.json` 0600(回退)。

#### Scenario: grep 检查
- **WHEN** 对 CLI 源码 grep `LEETCODE_SESSION` 或 `PHPSESSID`
- **THEN** 仅出现在 backend 实现与命令实现的内存路径中,无任何 `fs.writeFile.*config.toml` 路径写入它们

## MODIFIED Requirements

### Requirement: TOML 配置文件位置

`packages/cli` SHALL 使用以下优先级解析配置文件路径:

1. CLI flag `--config <path>` 指定路径(绝对或相对)
2. 环境变量 `OJ_AGENT_CONFIG`
3. **共享配置目录**：`~/.oj-agent/config.toml`（优先级高于旧的 XDG 路径）
4. Unix:`$XDG_CONFIG_HOME/oj-agent/config.toml`,缺省 `~/.config/oj-agent/config.toml`（向后兼容）
5. Windows:`%APPDATA%/oj-agent/config.toml`（向后兼容）

文件不存在时 MUST 不抛错,所有字段返回 schema 默认值;首次 `config set` 时自动创建文件与父目录(权限 `0700` 目录、`0600` 文件,Windows 容忍)。

**迁移逻辑**：首次启动时，若 `~/.oj-agent/config.toml` 不存在但旧路径（XDG/APPDATA）存在，SHALL 自动复制旧配置到新路径，并在 stderr 提示迁移完成。

#### Scenario: 默认路径解析
- **WHEN** Unix 系统未设 `XDG_CONFIG_HOME`,无 `--config` 与 `OJ_AGENT_CONFIG`
- **THEN** `oja status` 输出的 `configPath` 为 `~/.oj-agent/config.toml`

#### Scenario: 文件不存在不抛错
- **WHEN** config 文件不存在,执行 `oja config get workspace.root`
- **THEN** 输出默认值 `~/oj-agent-workspace`,退出码 0

#### Scenario: 自动迁移旧配置
- **WHEN** `~/.config/oj-agent/config.toml` 存在但 `~/.oj-agent/config.toml` 不存在，首次启动
- **THEN** 旧配置被复制到 `~/.oj-agent/config.toml`，stderr 提示 `Config migrated to ~/.oj-agent/config.toml`

### Requirement: Session 读写改为 SharedConfigStore

`packages/cli` 的 session 持久化 SHALL 改为调用 `SharedConfigStore.getSession / setSession / deleteSession`，不再使用独立的 secret backend。

登录命令（`oja login`）SHALL 在认证成功后调用 `SharedConfigStore.setSession(platform, credential)`，登出命令（`oja logout`）SHALL 调用 `SharedConfigStore.deleteSession(platform)`。

#### Scenario: 登录后 session 写入共享存储
- **WHEN** 执行 `oja login hdoj` 成功
- **THEN** `~/.oj-agent/sessions.json` 中包含 hdoj 的 session 数据

#### Scenario: 登出后 session 从共享存储删除
- **WHEN** 执行 `oja logout hdoj`
- **THEN** `~/.oj-agent/sessions.json` 中不再包含 hdoj 的 session 数据

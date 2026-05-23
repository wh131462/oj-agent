## Context

当前 CLI（`packages/cli`）和 VSCode 插件（`packages/vscode`）各自维护独立的配置和 session 存储：

- CLI 通过 `cli-config-backend` 将配置写入本地私有路径
- VSCode 通过 `vscode-backends` 使用 VSCode ExtensionContext 的 globalState/secrets 存储
- `auth-manager-core` 的 session 持久化分别绑定到各自的 backend

两者无法感知对方的状态变更，用户需要在两个环境中重复认证和配置。

## Goals / Non-Goals

**Goals:**
- 引入 `shared-config-store` 模块，统一管理 `~/.oj-agent/` 下的 session 和 AI 配置持久化
- CLI 和 VSCode 插件共读同一份配置文件，任意一端写入后另一端可感知
- VSCode 插件通过 chokidar watch 机制热加载配置变更（无需重启）
- 迁移 `cli-config-backend`、`vscode-backends`、`auth-manager-core` 至共享存储层

**Non-Goals:**
- 不实现跨机器/云端同步
- 不处理多用户场景下的权限隔离
- 不引入新的外部依赖（chokidar 已存在）
- 不改变现有 API 接口和平台适配器

## Decisions

**决策 1：存储位置使用 `~/.oj-agent/` 目录**

- 选择：`~/.oj-agent/config.json`（AI 配置）+ `~/.oj-agent/session.json`（session）
- 原因：用户级全局目录，CLI 和 VSCode 进程均可访问，符合 XDG-like 惯例
- 备选：项目级 `.oj-agent/`——被否决，因为用户可能在多个项目中使用插件

**决策 2：shared-config-store 放在 `packages/core/src/shared-config/`**

- 选择：复用已有 `packages/core` 包，不新建 `packages/shared`
- 原因：core 包已被 CLI 和 VSCode 双端依赖，避免引入新的包依赖链
- 备选：新建 `packages/shared`——被否决，增加 monorepo 复杂度

**决策 3：VSCode 端使用 chokidar watch，CLI 端不需要 watch**

- 选择：VSCode 插件在激活时启动 file watcher，检测到变更后触发内部事件刷新 session/config
- 原因：CLI 是短生命周期进程，每次运行直接读文件即可；VSCode 是长生命周期，需要热加载
- 备选：轮询——被否决，资源浪费

**决策 4：文件格式使用 JSON，敏感字段（API Key）使用 keytar/系统钥匙串**

- 选择：非敏感配置（模型选择、参数）写 JSON 明文；API Key 沿用现有 cli-secret-backend（keytar）机制，shared-config-store 不直接存储 secrets
- 原因：保持安全性，避免 API Key 明文落盘

## Risks / Trade-offs

- **并发写入冲突** → 两端同时写入同一文件可能产生竞态。缓解：写入时使用原子替换（write to tmp + rename），读取时容忍 JSON parse 失败并回退默认值
- **文件权限问题** → `~/.oj-agent/` 目录不存在时需自动创建，权限设为 700
- **VSCode 多窗口场景** → 多个 VSCode 窗口同时 watch 同一文件，每个窗口独立响应变更事件，无副作用
- **迁移兼容性** → 现有用户的旧配置位置需要迁移或保留回退读取逻辑，首次启动时自动迁移

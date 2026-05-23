## Why

当用户同时使用 CLI 和 VSCode 插件时，两者各自维护独立的 session（登录态）和 AI 配置（模型选择、API Key、参数等），导致重复配置、状态不一致的问题。需要一个共享机制，让 CLI 和 VSCode 插件能读写同一份配置和会话状态。

## What Changes

- **新增** 共享配置存储层，统一管理 session 和 AI 配置的持久化位置（如 `~/.oj-agent/config.json`）
- **新增** session 共享能力：CLI 登录后，VSCode 插件可直接复用已有 session，无需重新认证
- **新增** AI 配置共享能力：在 CLI 或 VSCode 任一端修改模型/API Key/参数后，另一端自动感知
- **修改** CLI config 后端：从私有存储迁移至共享存储层
- **修改** VSCode backends：从私有存储迁移至共享存储层
- **修改** auth-manager-core：session 持久化改为写入共享存储

## Capabilities

### New Capabilities

- `shared-config-store`: 统一的跨进程配置/session 持久化层，负责读写 `~/.oj-agent/` 下的共享文件，提供 watch 机制供 VSCode 插件热加载变更

### Modified Capabilities

- `cli-config-backend`: 配置读写改为通过 shared-config-store，不再自己维护独立存储
- `vscode-backends`: session 和 AI 配置的读写改为通过 shared-config-store
- `auth-manager-core`: session 持久化目标改为 shared-config-store 的 session 文件

## Impact

- 影响 `packages/cli/src/config/` 相关模块
- 影响 `packages/vscode/src/backends/` 相关模块
- 影响 `packages/core/src/auth/` session 持久化逻辑
- 新增 `packages/shared/` 或 `packages/core/` 下的 shared-config-store 模块
- 无外部新依赖（使用 Node.js fs/chokidar，chokidar 已在项目中）
- 不影响现有 API 接口和平台适配器

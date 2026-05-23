## 1. 新增 shared-config-store 模块

- [x] 1.1 在 `packages/core/src/shared-config/` 下创建 `SharedConfigStore` 类，负责读写 `~/.oj-agent/config.json` 和 `~/.oj-agent/session.json`
- [x] 1.2 实现文件 watch 机制（基于 chokidar），提供 `onChange(listener)` 并返回 Disposable
- [x] 1.3 实现原子写：临时文件 + `fs.rename`，父目录不存在时自动创建（权限 0700/0600）
- [x] 1.4 导出 `SharedConfigStore` 及相关类型（`SharedSession`, `SharedAIConfig`）

## 2. 迁移 auth-manager-core session 持久化

- [x] 2.1 修改 `SecretCredentialStore`，新增可选 `sharedConfigStore` 参数
- [x] 2.2 `set` / `delete` 时同步写入 `SharedConfigStore` 的 session 文件（`~/.oj-agent/session.json`）
- [x] 2.3 初始化时从 `SharedConfigStore` 加载已有 session 并注入 `SecretBackend`

## 3. 迁移 cli-config-backend

- [x] 3.1 修改 `TomlConfigBackend`，新增 `SharedConfigStore` 依赖注入
- [x] 3.2 AI 配置字段（`ai.model`、`ai.apiKey`、`ai.baseUrl` 等）读写改为经由 `SharedConfigStore`，其余字段仍走 TOML
- [x] 3.3 监听 `SharedConfigStore.onChange`，当 AI 配置变更时触发自身的 config change 事件

## 4. 迁移 vscode-backends

- [x] 4.1 在 `VSCodeConfigBackend` 中注入 `SharedConfigStore`
- [x] 4.2 AI 配置的读写改为经由 `SharedConfigStore`（写时同步文件，读时优先文件）
- [x] 4.3 `VSCodeSecretBackend` 在 session `set` / `delete` 时同步写入 `SharedConfigStore` 的 session 文件
- [x] 4.4 注册 `SharedConfigStore` 的 `onChange` 监听，文件变更时通知 VSCode 侧刷新状态（StatusBar、TreeView）

## 5. 激活顺序与注入调整

- [x] 5.1 修改 VSCode 扩展 `activate` 函数，在构造 `VSCodeSecretBackend` / `VSCodeConfigBackend` 之前先实例化 `SharedConfigStore`
- [x] 5.2 修改 CLI 入口，在构造 `TomlConfigBackend` 之前先实例化 `SharedConfigStore`
- [x] 5.3 确保所有 `SharedConfigStore` 实例均通过 `context.subscriptions.push` 或 CLI 退出钩子正确释放 watcher

## 6. 验证

- [ ] 6.1 手动验证：CLI `oja config set ai.model gpt-4o` 后，VSCode 插件热加载显示新模型
- [ ] 6.2 手动验证：CLI 登录平台后，VSCode 插件无需重新认证即可使用 session
- [ ] 6.3 手动验证：VSCode 插件修改 AI 配置后，CLI `oja config get ai.model` 返回新值

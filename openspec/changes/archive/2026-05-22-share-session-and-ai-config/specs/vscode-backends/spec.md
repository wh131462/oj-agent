## ADDED Requirements

### Requirement: SharedConfigStore 集成

VSCode 扩展 SHALL 在激活时构造 `SharedConfigStore` 实例，并将其注入到 `CredentialStore` 与 AI 配置读写路径中，使 VSCode 端的 session 与 AI 配置直接落到 `~/.oj-agent/` 共享文件，与 CLI 共用同一份数据。

激活时 MUST 启动 `SharedConfigStore.watch`，监听到 `session` 变更时刷新 StatusBar 与 TreeView 的登录状态显示；监听到 `ai-config` 变更时刷新 AI 设置面板。Disposable MUST `context.subscriptions.push(...)`。

#### Scenario: CLI 登录后 VSCode 自动感知
- **WHEN** CLI 执行 `oja login hdoj` 成功，VSCode 窗口已打开并激活了扩展
- **THEN** 1 秒内 VSCode StatusBar 显示 hdoj 已登录，TreeView 显示已登录用户名

#### Scenario: VSCode 修改 AI 配置后 CLI 读到最新
- **WHEN** 用户在 VSCode AI 设置面板切换激活 profile，并保存
- **THEN** 后续 `oja` 命令读取的激活 AI profile 与 VSCode 一致

## MODIFIED Requirements

### Requirement: VSCodeSecretBackend

扩展 SHALL 提供 `VSCodeSecretBackend implements SecretBackend`,封装 `vscode.ExtensionContext.secrets`:
- `get(key)` → `context.secrets.get(key)`
- `set(key, value)` → `context.secrets.store(key, value)`
- `delete(key)` → `context.secrets.delete(key)`

`VSCodeSecretBackend` 仅用于存储 **API Key 等纯敏感字符串**（键名前缀 `ai.apiKey.*`）。

**OJ 平台 session（cookie/token）不再通过此 backend 存储**，而是通过 `SharedConfigStore.setSession/getSession` 写入共享文件 `~/.oj-agent/sessions.json`，以便 CLI 端读取。

激活时 MUST 把该 backend 注入到 `ApiKeyVault`（AI 用），不再注入到 `SecretCredentialStore`；后者改为基于 `SharedConfigStore` 实现。

#### Scenario: AI Key 仍写 SecretStorage
- **WHEN** 用户在 AI 设置面板填入 apiKey，扩展调用 `apiKeyVault.set('default', 'sk-xxx')`
- **THEN** `context.secrets.get('ai.apiKey.default')` 返回 `'sk-xxx'`

#### Scenario: OJ session 写入共享文件而非 SecretStorage
- **WHEN** 完成 HDOJ 登录，扩展调用 `credentialStore.set('hdoj', ...)`
- **THEN** `~/.oj-agent/sessions.json` 中包含 hdoj 的 session；`context.secrets.get('oj.cookie.hdoj')` 返回 `undefined`

### Requirement: 激活与注入顺序

扩展 `activate(context)` 函数 SHALL 按以下顺序构造对象:

1. `logger = new VSCodeOutputChannelLogger()`
2. `secretBackend = new VSCodeSecretBackend(context.secrets)`
3. `configBackend = new VSCodeConfigBackend()`
4. **`sharedConfigStore = new SharedConfigStore({ logger })`**
5. **`credentialStore = new SharedCredentialStore(sharedConfigStore)`**（替换原 `SecretCredentialStore`）
6. `apiKeyVault = new ApiKeyVault(secretBackend)`
7. `rateLimiter = new RateLimiter()`
8. `httpClient = new HttpClient({ credentialStore, rateLimiter, logger, proxyUrl })`
9. `registry = new PlatformAdapterRegistry({ httpClient, credentialStore, rateLimiter })`
10. `workspaceManager = new WorkspaceManager({ logger })`
11. `judgeRunner = new JudgeRunner({ logger, configBackend })`
12. `submissionRunner = new SubmissionRunner({ registry, credentialStore, logger })`
13. **启动 `sharedConfigStore.watch(...)`，订阅 session/ai-config 变更，刷新 UI**
14. 注册命令、TreeView、StatusBar(订阅 credentialStore.onChange 与 configBackend.onChange)

所有 disposable MUST `context.subscriptions.push(...)`。

#### Scenario: 注入完整
- **WHEN** 扩展激活
- **THEN** 所有 core 对象创建成功，`sharedConfigStore` 处于 watching 状态，命令注册数等于 contributes.commands 总数

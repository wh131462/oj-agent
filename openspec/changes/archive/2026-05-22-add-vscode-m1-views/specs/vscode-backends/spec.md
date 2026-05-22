## ADDED Requirements

### Requirement: VSCodeSecretBackend

扩展 SHALL 提供 `VSCodeSecretBackend implements SecretBackend`,封装 `vscode.ExtensionContext.secrets`:
- `get(key)` → `context.secrets.get(key)`
- `set(key, value)` → `context.secrets.store(key, value)`
- `delete(key)` → `context.secrets.delete(key)`

激活时 MUST 把该 backend 注入到 core 的 `SecretCredentialStore` 与已有 `ApiKeyVault`(AI 用)。两者共享同一 backend,通过键名前缀(`oj.cookie.*` vs `ai.apiKey.*`)隔离。

#### Scenario: 凭证落入 SecretStorage
- **WHEN** 完成 HDOJ 登录,扩展调用 `credentialStore.set('hdoj', ...)`
- **THEN** `context.secrets.get('oj.cookie.hdoj')` 返回 JSON 字符串包含 PHPSESSID

#### Scenario: 命名空间隔离
- **WHEN** 已配置 AI Profile,`context.secrets.get('ai.apiKey.default') !== undefined`
- **THEN** `credentialStore.get('leetcode-cn')` 不会读到该 AI Key,反之亦然

### Requirement: VSCodeConfigBackend

扩展 SHALL 提供 `VSCodeConfigBackend implements ConfigBackend`,基于 `vscode.workspace.getConfiguration('ojAgent')`:
- `get<T>(key, defaultValue)` → `cfg.get<T>(key, defaultValue!)`(支持点路径,如 `'workspace.root'`)
- `onChange(listener)` → 包装 `workspace.onDidChangeConfiguration`,过滤 `affectsConfiguration('ojAgent')`,变更时把对应子 key 路径数组传给 listener

注入到 core 的 `WorkspaceManager / JudgeRunner / SubmissionRunner`(分别在创建时取出所需 key)。

#### Scenario: 读 workspace.root
- **WHEN** 用户在 settings.json 设 `"ojAgent.workspace.root": "/tmp/ws"`
- **THEN** `configBackend.get('workspace.root', '~/oj-agent-workspace') === '/tmp/ws'`

#### Scenario: 变更通知
- **WHEN** 用户修改 `ojAgent.judge.timeoutMs`
- **THEN** listener 被以 `{ affectedKeys: ['judge.timeoutMs'] }` 调用一次

### Requirement: VSCodeOutputChannelLogger

扩展 SHALL 提供 `VSCodeOutputChannelLogger implements LoggerBackend`,基于 `vscode.window.createOutputChannel('OJ-Agent', { log: true })`:
- `info(scope, msg, extra)` → `channel.info('[' + scope + '] ' + msg + (extra ? JSON.stringify(extra) : ''))`
- `warn(scope, msg, extra)` → `channel.warn(...)`
- `error(scope, msg, err)` → `channel.error(...)`(err 是 Error 时序列化 stack)

OutputChannel MUST 在扩展激活时创建一次并复用。命令 `ojAgent.openOutputChannel` 显示该 channel。

#### Scenario: info 路由到 OutputChannel
- **WHEN** core 调用 `logger.info('judge', 'compile OK')`
- **THEN** OutputChannel 中追加一行 `[INFO] [judge] compile OK`(VSCode log channel 默认带 level prefix)

#### Scenario: 打开 OutputChannel
- **WHEN** 执行 `ojAgent.openOutputChannel`
- **THEN** 底部 OUTPUT 面板被聚焦到 `OJ-Agent` channel

### Requirement: 激活与注入顺序

扩展 `activate(context)` 函数 SHALL 按以下顺序构造对象:

1. `logger = new VSCodeOutputChannelLogger()`
2. `secretBackend = new VSCodeSecretBackend(context.secrets)`
3. `configBackend = new VSCodeConfigBackend()`
4. `credentialStore = new SecretCredentialStore(secretBackend)`
5. `rateLimiter = new RateLimiter()`
6. `httpClient = new HttpClient({ credentialStore, rateLimiter, logger, proxyUrl })`
7. `registry = new PlatformAdapterRegistry({ httpClient, credentialStore, rateLimiter })`
8. `workspaceManager = new WorkspaceManager({ logger })`
9. `judgeRunner = new JudgeRunner({ logger, configBackend })`
10. `submissionRunner = new SubmissionRunner({ registry, credentialStore, logger })`
11. 注册命令、TreeView、StatusBar(订阅 credentialStore.onChange 与 configBackend.onChange)

所有 disposable MUST `context.subscriptions.push(...)`。

#### Scenario: 注入完整
- **WHEN** 扩展激活
- **THEN** 所有 core 对象创建成功,命令注册数等于 contributes.commands 中 M1 新增 + 既有 AI 14 条

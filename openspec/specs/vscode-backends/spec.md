# vscode-backends Specification

## Purpose

定义 VSCode 扩展端为 core 抽象层提供的运行时后端实现,包括基于 `SecretStorage` 的密钥后端、基于 `OutputChannel` 的日志后端,以及扩展激活时的注入注册顺序。

## Requirements

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

### Requirement: 设置面板暴露核心配置

VSCode 扩展 SHALL 在 `settings-panel.ts` Webview 中分组展示并允许编辑下列配置,所有写入 MUST 通过 `VSCodeConfigBackend.set` 持久化到 `vscode.workspace.getConfiguration('ojAgent')`:

- 工作区:`workspace.root`
- 网络:`network.requestIntervalMs`、`network.timeoutMs`、`network.proxy`
- 平台:每个平台的能力降级提示与登录入口入口按钮
- AI Profile:激活 Profile 的下拉选择(列表与编辑仍走 `oja ai profile` / 既有命令)

#### Scenario: 修改请求间隔生效
- **WHEN** 用户在设置面板把 `network.requestIntervalMs` 从 1000 改为 2000 并保存
- **THEN** `workspace.getConfiguration('ojAgent').get('network.requestIntervalMs') === 2000`,后续平台请求按新间隔限速

#### Scenario: 切换激活 AI Profile
- **WHEN** 用户在下拉中选择新 Profile
- **THEN** 配置写入 `ojAgent.ai.activeProfile`,AI 助手命令使用新 Profile,无需重启

#### Scenario: 平台降级提示展示
- **WHEN** 蓝桥云课适配器声明 `degraded`
- **THEN** 平台分组中显示 `degraded.reason` 文案与 "登录蓝桥云课" 按钮

### Requirement: 新平台 UI 集成

VSCode 扩展 SHALL 为 Codeforces / 洛谷 / POJ / 蓝桥云课 提供与 LeetCode CN / HDOJ 一致的 TreeView 节点、状态栏登录态展示与登录入口命令。新平台命令 ID 命名为 `ojAgent.<platform>.login`、`ojAgent.<platform>.logout`。

#### Scenario: TreeView 显示新平台
- **WHEN** 扩展激活后打开侧边栏
- **THEN** 平台分组列出全部 6 个平台,各自含 "题库" 与 "已拉取" 子节点

#### Scenario: 状态栏登录态
- **WHEN** 已登录 Codeforces,未登录洛谷
- **THEN** 状态栏显示 "CF✓ 洛谷✗" 等区分图标,点击后弹出登录入口

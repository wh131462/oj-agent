## ADDED Requirements

### Requirement: SharedConfigStore 接口

`@oj-agent/core` 或 `@oj-agent/shared` SHALL 提供 `SharedConfigStore`，负责在 `~/.oj-agent/` 目录下持久化存储跨进程共享的 session 和 AI 配置。

接口形态：
```ts
interface SharedConfigStore {
  getSession(platform: PlatformId): Promise<PlatformCredential | undefined>;
  setSession(platform: PlatformId, cred: PlatformCredential): Promise<void>;
  deleteSession(platform: PlatformId): Promise<void>;
  getAIConfig(): Promise<AIConfig>;
  setAIConfig(config: Partial<AIConfig>): Promise<void>;
  watch(listener: (event: ConfigChangeEvent) => void): Disposable;
}
```

存储路径：
- session 文件：`~/.oj-agent/sessions.json`
- AI 配置文件：`~/.oj-agent/ai-config.json`

目录不存在时 MUST 自动创建（权限 `0700`，文件 `0600`，Windows 容忍）。

#### Scenario: 写入并读取 session
- **WHEN** 调用 `store.setSession('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc' })` 后再 `store.getSession('hdoj')`
- **THEN** 返回的对象 `cookie === 'PHPSESSID=abc'`，且 `~/.oj-agent/sessions.json` 文件已更新

#### Scenario: 写入并读取 AI 配置
- **WHEN** 调用 `store.setAIConfig({ model: 'gpt-4o', apiKey: 'sk-xxx' })` 后再 `store.getAIConfig()`
- **THEN** 返回 `{ model: 'gpt-4o', apiKey: 'sk-xxx' }`，且 `~/.oj-agent/ai-config.json` 已更新

#### Scenario: 目录不存在时自动创建
- **WHEN** `~/.oj-agent/` 目录不存在，首次调用 `setSession`
- **THEN** 目录与文件被自动创建，操作成功，退出码 0

### Requirement: 原子写入

`SharedConfigStore` 的所有写操作 SHALL 使用临时文件 + `fs.rename` 完成原子写。中途崩溃 MUST 不留下半写文件。

#### Scenario: 原子持久化
- **WHEN** `setSession` 或 `setAIConfig` 中途中断（测试时模拟）
- **THEN** 原文件内容未变更

### Requirement: 文件 watch 变更通知

`SharedConfigStore.watch` SHALL 使用 `chokidar` 监听 `~/.oj-agent/sessions.json` 与 `~/.oj-agent/ai-config.json`，文件变更时触发 listener，通知包含 `{ type: 'session' | 'ai-config' }`。

MUST 在 Disposable.dispose() 调用后停止监听，不再触发 listener。

#### Scenario: 另一进程写入后触发 watch
- **WHEN** CLI 进程修改 `~/.oj-agent/sessions.json`，VSCode 已注册 watch listener
- **THEN** VSCode 端 listener 在文件变更后被以 `{ type: 'session' }` 调用

#### Scenario: dispose 后不再通知
- **WHEN** `disposable.dispose()` 后文件被修改
- **THEN** 该 listener 不再被调用

### Requirement: AIConfig 数据结构

`AIConfig` SHALL 包含 `{ profiles: AIProfile[]; activeProfileId: string }`，`AIProfile` 包含 `{ id: string; model: string; apiKey?: string; baseUrl?: string; maxTokens?: number; temperature?: number }`。

`apiKey` MUST NOT 明文存储在 `ai-config.json` 中；SHALL 存储在平台对应的 secret store 中（CLI 用 keytar 或 `~/.oj-agent/.secrets`，VSCode 用 `SecretStorage`），`ai-config.json` 中对应字段存储引用 key 而非明文值。

#### Scenario: apiKey 不明文落盘
- **WHEN** 调用 `setAIConfig({ profiles: [{ id: 'default', model: 'claude-3', apiKey: 'sk-xxx' }] })`
- **THEN** `~/.oj-agent/ai-config.json` 中不包含 `'sk-xxx'`，apiKey 通过 secret backend 存储

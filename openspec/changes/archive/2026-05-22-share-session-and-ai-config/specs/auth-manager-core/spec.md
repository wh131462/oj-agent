## MODIFIED Requirements

### Requirement: CredentialStore 接口

`@oj-agent/core` SHALL 提供 `CredentialStore` 接口与基于 `SecretBackend` 的默认实现 `SecretCredentialStore`,用于跨前端统一管理各平台登录凭证。

接口形态:
```ts
interface CredentialStore {
  get(platform: PlatformId): Promise<PlatformCredential | undefined>;
  set(platform: PlatformId, cred: PlatformCredential): Promise<void>;
  delete(platform: PlatformId): Promise<void>;
  onChange(listener: (platform: PlatformId) => void): Disposable;
}
```

`SecretCredentialStore` 的持久化目标 SHALL 改为通过 `SharedConfigStore` 写入 `~/.oj-agent/session.json`,不再直接依赖 `SecretBackend` 写入平台特定存储。CLI 端使用文件存储；VSCode 端优先使用 `VSCodeSecretBackend`（通过 `SharedConfigStore` 的适配）。

#### Scenario: 写入与读取（经 SharedConfigStore）
- **WHEN** 调用 `store.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc' })` 后再 `store.get('hdoj')`
- **THEN** 返回的对象 `cookie === 'PHPSESSID=abc'`,且 `~/.oj-agent/session.json` 中包含对应条目

#### Scenario: CLI 与 VSCode 共享 session
- **WHEN** CLI 端执行登录并写入 session,VSCode 插件随后调用 `store.get('hdoj')`
- **THEN** VSCode 端读取到相同的凭证,无需重新认证

#### Scenario: 删除
- **WHEN** 调用 `store.delete('hdoj')` 后 `store.get('hdoj')`
- **THEN** 返回 `undefined`,且 `~/.oj-agent/session.json` 中对应条目被移除

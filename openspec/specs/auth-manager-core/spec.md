# auth-manager-core Specification

## Purpose

定义 `@oj-agent/core` 中跨平台凭证管理能力 `CredentialStore` 及其默认实现 `SecretCredentialStore`,负责 OJ 平台 Cookie/Token 的安全存取、命名空间隔离、变更通知与失效探活。

## Requirements

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

#### Scenario: 写入与读取
- **WHEN** 调用 `store.set('hdoj', { platform: 'hdoj', cookie: 'PHPSESSID=abc' })` 后再 `store.get('hdoj')`
- **THEN** 返回的对象 `cookie === 'PHPSESSID=abc'`

#### Scenario: 删除
- **WHEN** 调用 `store.delete('hdoj')` 后 `store.get('hdoj')`
- **THEN** 返回 `undefined`

### Requirement: 命名空间隔离

`SecretCredentialStore` SHALL 使用键名 `oj.cookie.<platform>` 序列化为 JSON 存入 `SecretBackend`。`@oj-agent/core` 现有 AI 凭证使用前缀 `ai.apiKey.*`,两个前缀 MUST 绝对不互相读取或覆盖。

#### Scenario: AI Key 不被 OJ 读到
- **WHEN** `SecretBackend` 中存在 `ai.apiKey.default = 'sk-...'`
- **THEN** `credentialStore.get('leetcode-cn')` 返回 `undefined`,且任何 PlatformId 都读不到该 key

#### Scenario: OJ Cookie 不被 AI 读到
- **WHEN** `credentialStore.set('hdoj', { cookie: 'X' })` 后
- **THEN** `ApiKeyVault.get('default')` 不读到 `'X'`,只能读到自身命名空间下的值

### Requirement: 变更通知

`CredentialStore.onChange` SHALL 在 `set / delete` 执行成功后同步触发监听器,且 MUST 返回一个 `Disposable`,调用 `dispose()` 后监听器 MUST NOT 再被调用。

#### Scenario: set 触发通知
- **WHEN** 已注册 `listener`,调用 `store.set('hdoj', ...)`
- **THEN** `listener` 被以 `'hdoj'` 调用一次

#### Scenario: dispose 后不再通知
- **WHEN** `disposable.dispose()` 后调用 `store.set('hdoj', ...)`
- **THEN** 该 listener 不再被调用

### Requirement: 凭证形态

`PlatformCredential` SHALL 至少包含 `{ platform: PlatformId; cookie?: string; token?: string; extra?: Record<string,string> }`。`cookie` 字段格式 MUST 为 `name=value; name=value`(直接可用作 HTTP `Cookie` 头)。

#### Scenario: 多 Cookie 拼接
- **WHEN** LeetCode CN 登录后凭证为 `{ cookie: 'LEETCODE_SESSION=a; csrftoken=b' }`
- **THEN** `HttpClient` 注入时直接作为 `Cookie` 头使用,无需额外解析

### Requirement: 失效探活

`@oj-agent/core` SHALL 提供 `CredentialChecker.check(platform)` 工具:对每个平台用一次只读、低成本的请求(如 LeetCode CN `userStatus` GraphQL、HDOJ `userloginex.php` 状态判断)探活,返回 `'valid' | 'expired' | 'unknown'`。`check` MUST 不修改 store,MUST 不抛出业务错(失败一律返回 `'unknown'`)。

#### Scenario: 凭证有效
- **WHEN** LeetCode CN cookie 有效,`userStatus.isSignedIn === true`
- **THEN** `check('leetcode-cn')` 返回 `'valid'`

#### Scenario: 凭证失效
- **WHEN** cookie 已过期,平台返回 `userStatus.isSignedIn === false`
- **THEN** `check('leetcode-cn')` 返回 `'expired'`

#### Scenario: 网络错误
- **WHEN** 探活请求超时
- **THEN** `check('leetcode-cn')` 返回 `'unknown'`,MUST NOT 抛异常

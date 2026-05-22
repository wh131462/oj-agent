# browser-auto-login Specification

## Purpose

定义 `@oj-agent/core` 中浏览器自动登录能力的接口与编排规范:`BrowserLoginCapture` 抽象、`LoginConfig` 配置形态、各平台内置 LoginConfig、`LoginFlow` 编排器,以及实现侧的安全约束(临时 userDataDir、cookie 域隔离、敏感值不落日志)。core 层 MUST NOT 包含具体浏览器实现,前端通过依赖注入提供 `PlaywrightBrowserLogin` 等具体实现。

## Requirements

### Requirement: BrowserLoginCapture 接口

`@oj-agent/core` SHALL 提供 `BrowserLoginCapture` 接口,封装"启动浏览器 → 等待用户登录完成 → 抽 cookie + username"的能力。core MUST NOT 包含具体浏览器实现;前端通过依赖注入提供 `PlaywrightBrowserLogin` 等具体实现。

```ts
interface BrowserLoginCapture {
  capture(config: LoginConfig): Promise<CapturedAuth>;
  /** 取消正在进行的捕获(关闭浏览器进程)。 */
  cancel?(): Promise<void>;
}
```

#### Scenario: 接口零 IDE 依赖

- **WHEN** grep `packages/core/src/auth/browser-login.ts`
- **THEN** 不出现 `vscode`、`playwright`、`puppeteer` 字样

#### Scenario: 通过依赖注入消费

- **WHEN** 前端代码构造 `LoginFlow` 时
- **THEN** MUST 传入实现了 `BrowserLoginCapture` 的对象;core 不假定具体浏览器引擎

### Requirement: LoginConfig 配置形态

`LoginConfig` SHALL 包含登录页 URL、登录完成信号、可选的用户名抽取函数与超时:

```ts
interface LoginConfig {
  platform: PlatformId;
  loginUrl: string;
  ready: {
    urlPattern?: RegExp;
    cookieName?: string;
    selector?: string;
  };
  extractUsername?: (page: BrowserPageHandle) => Promise<string | null>;
  cookieDomain?: string;
  timeoutMs?: number;  // 默认 300_000(5 分钟)
}
```

`ready` 中三个字段为"任一满足"(逻辑或),只要任意一个匹配即视为登录成功。MUST 至少声明其中一个。

#### Scenario: 至少一个 ready 信号

- **WHEN** 调用 `capture(config)`,`config.ready` 为 `{}`
- **THEN** capture 立即抛 `Error('LoginConfig.ready 必须至少声明一个信号')`

#### Scenario: 默认超时

- **WHEN** `config.timeoutMs` 缺省
- **THEN** 实际生效超时为 300_000ms(5 分钟)

### Requirement: 平台 LoginConfig 内置

`@oj-agent/core` SHALL 内置 LeetCode CN 与 HDOJ 的 `LoginConfig`,挂在 `platformLoginConfigs[platformId]` 上,前端可直接复用。

LeetCode CN 配置 MUST 满足:
- `loginUrl`:`https://leetcode.cn/accounts/login/`
- `ready.cookieName`:`LEETCODE_SESSION`
- `ready.urlPattern`:匹配登录后重定向(如 `/^https:\/\/leetcode\.cn\/(?:problemset|u\/|premium|$)/`)
- `cookieDomain`:`.leetcode.cn`
- `extractUsername`:在登录后访问 `/u/me/`(平台会自动跳到 `/u/<username>/`),从最终 URL 抽取用户名

HDOJ 配置 MUST 在 core 中定义但实现可延后,作为预留接口:
- `loginUrl`:`http://acm.hdu.edu.cn/userloginex.php`
- `ready.urlPattern`:`/control_panel\.php/`
- `cookieDomain`:`.hdu.edu.cn`

#### Scenario: 复用配置

- **WHEN** 调用 `platformLoginConfigs['leetcode-cn']`
- **THEN** 返回上述 config 对象

#### Scenario: 未实现平台

- **WHEN** 调用 `platformLoginConfigs['codeforces']`
- **THEN** 返回 `undefined`

### Requirement: LoginFlow 编排

`@oj-agent/core` SHALL 提供 `LoginFlow.run(config)` 编排器:

```ts
class LoginFlow {
  constructor(deps: {
    capture: BrowserLoginCapture;
    credentialStore: CredentialStore;
    credChecker: CredentialChecker;
    logger?: LoggerBackend;
  });
  run(config: LoginConfig): Promise<LoginResult>;
}

type LoginResult =
  | { ok: true; username?: string; browserInfo?: { name: string; path: string; version?: string } }
  | { ok: false; reason: 'browser-not-found' | 'capture-failed' | 'auth-invalid' | 'timeout' | 'cancelled'; message: string };
```

执行步骤:
1. `capture.capture(config)` 拿 `CapturedAuth { cookie, username? }`
2. 把 cookie 写入 `credentialStore.set(platform, { platform, cookie, extra: { username? } })`
3. 调 `credChecker.check(platform)` 校验
4. `valid` → 返回 `{ ok: true, username }`
5. `expired | unknown` → 调 `credentialStore.delete(platform)`,返回 `{ ok: false, reason: 'auth-invalid' }`
6. capture 抛 `BROWSER_NOT_FOUND` → 返回 `{ ok: false, reason: 'browser-not-found' }`(不抛错,让上层降级)
7. capture 抛超时 → `{ ok: false, reason: 'timeout' }`
8. capture 抛其他错 → `{ ok: false, reason: 'capture-failed', message }`

`LoginFlow.run` MUST NOT 抛异常,所有路径都通过 `LoginResult.ok` 返回。

#### Scenario: 自动登录成功

- **WHEN** capture 返回 `{ cookie, username: 'foo' }`,credChecker 返回 `valid`
- **THEN** `run()` 返回 `{ ok: true, username: 'foo' }`,credentialStore 中已有 `oj.cookie.<platform>` 记录

#### Scenario: 浏览器不可用降级

- **WHEN** capture 抛 `BrowserNotFoundError`
- **THEN** `run()` 返回 `{ ok: false, reason: 'browser-not-found', ... }`,credentialStore 不被修改

#### Scenario: 校验失败回滚

- **WHEN** capture 成功但 credChecker 返回 `expired`
- **THEN** `run()` 返回 `{ ok: false, reason: 'auth-invalid' }`,credentialStore 被清理(任何半写入的凭证 MUST 被删除)

#### Scenario: 超时清理

- **WHEN** 超过 `config.timeoutMs` 浏览器仍未完成登录
- **THEN** capture 抛超时,run 返回 `{ ok: false, reason: 'timeout' }`,浏览器进程 MUST 被 kill

#### Scenario: 用户取消

- **WHEN** 上层调 `loginFlow.cancel()`(透传到 capture.cancel)
- **THEN** run 返回 `{ ok: false, reason: 'cancelled' }`,浏览器进程被 kill

### Requirement: 安全约束

`BrowserLoginCapture` 实现 MUST 满足:

- 使用临时 `userDataDir`(`os.tmpdir()` 下),MUST NOT 复用用户已有的浏览器 profile
- capture 完成后 MUST 关闭浏览器进程并删除临时 userDataDir
- 浏览器 MUST 以 headed(可见)模式启动,让用户能看到正在登录哪个站点
- `LoggerBackend` 输出中 MUST NOT 包含 cookie value(只允许 cookie name)
- `CapturedAuth.cookie` MUST 仅包含 `LoginConfig.cookieDomain` 域名下的 cookie(防止泄露其他站点 cookie)

#### Scenario: 临时 userDataDir 清理

- **WHEN** capture 成功完成
- **THEN** 启动时创建的 `userDataDir` 已被 `fs.rm` 删除

#### Scenario: cookie value 不入日志

- **WHEN** grep 整个 capture 实现的 logger 调用
- **THEN** 不出现把 `cookie.value` / `LEETCODE_SESSION` 值作为参数传给 logger 的代码

#### Scenario: 域名隔离

- **WHEN** `cookieDomain: '.leetcode.cn'`,浏览器内还访问了 `.zhihu.com`
- **THEN** 返回的 `cookie` 字符串只含 `.leetcode.cn` 域的 cookie

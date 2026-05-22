## Context

`add-cli-m1-commands` 与 `add-vscode-m1-views` 落地的登录流程都依赖用户从浏览器 DevTools 手动复制 cookie。M1 真实账号验证暴露 UX 瓶颈:第一次使用就让用户拿出 F12,门槛过高。

现状的两个登录路径:
- LeetCode CN:`oja login leetcode-cn` → 粘贴 SESSION + csrftoken;VSCode 端是 QuickInput 两步
- HDOJ:`oja login hdoj` → 用户名 + 密码 form POST(可行但低安全);VSCode 端是 Webview 内提交表单 + 注入脚本读 cookie

VSCode Webview 的方案对 HDOJ 还能工作(HDOJ cookie 非 HttpOnly),但对 LeetCode CN 不行(`LEETCODE_SESSION` HttpOnly,Webview JS 读不到)。

约束:
- 不能引入 OAuth(平台不支持)
- core 包必须保持零 IDE 依赖
- 不能要求用户安装额外软件 / 浏览器扩展
- 必须支持 macOS/Linux/Windows
- 失败降级路径必须保留(老用户 / 受限环境继续可用)
- VSCode 与 CLI 共享同一套 capture 实现(避免分叉)

干系人:首次使用 oja 的用户、刷题 IDE 用户、未来 M2 接入更多平台的开发者。

## Goals / Non-Goals

**Goals:**
- 用户执行 `oja login leetcode-cn` 后,30 秒内能完成登录,无需手动复制任何字符串
- VSCode `OJ-Agent: 登录` 命令体验对齐
- 失败时优雅降级到现有粘贴流程,带清晰错误信息
- 接口可复用,M2 接入新平台只需写 `LoginConfig`
- 不引入需原生编译的依赖(playwright-core 是纯 JS + 系统进程调用)

**Non-Goals:**
- 不实现自定义浏览器或 Web 渲染(playwright-core 复用系统浏览器)
- 不实现 OAuth(平台不支持)
- 不实现自动填充用户名密码(用户必须在浏览器内人工登录,符合各平台 ToS)
- 不实现"全平台一次登录"(每个平台独立)
- 不在 M1 范围内实现 HDOJ 的浏览器自动登录(HDOJ 现在的用户名/密码方案够用,本变更仅做 LeetCode CN;HDOJ 的 Browser 路径作为 LoginConfig 顺手定义但实现可延后)
- 不解决账号注册场景(只处理登录已有账号)

## Decisions

### D1:依赖位置 — playwright-core 装在前端包

`@oj-agent/core` 严守"零 IDE/Node 平台特定依赖"原则,因此 `playwright-core` 装在 `packages/cli` 与 `packages/vscode` 各自的 `optionalDependencies` 中,通过 dynamic `import('playwright-core')` 加载。core 只定义 `BrowserLoginCapture` 接口与 `LoginFlow` 编排器,不依赖任何 npm 包。

**备选**:把 playwright 装到 core → 否决,违反 monorepo-layout.spec.md 约束。

### D2:接口契约

```ts
// packages/core/src/auth/browser-login.ts
export interface BrowserLoginCapture {
  /** 启动浏览器,导航到 loginUrl,等待登录完成信号,返回 cookie + username。 */
  capture(config: LoginConfig): Promise<CapturedAuth>;
}

export interface LoginConfig {
  platform: PlatformId;
  loginUrl: string;
  /**
   * 检测登录完成的信号。任一满足即视为已登录:
   * - urlPattern: 当前 URL 匹配该正则(如已登录后会 302 到 /problemset/)
   * - cookieName: 出现指定 cookie 名(如 LEETCODE_SESSION)
   * - selector: 页面出现指定 DOM 选择器(如 .user-avatar)
   */
  ready: {
    urlPattern?: RegExp;
    cookieName?: string;
    selector?: string;
  };
  /** 完成登录后从 URL / 页面 / cookie 中提取用户名,失败返回 null。 */
  extractUsername?: (page: BrowserPageHandle) => Promise<string | null>;
  /**
   * cookie 域名过滤(默认全部 cookie)。LeetCode CN 用 ".leetcode.cn"。
   */
  cookieDomain?: string;
  /** 总超时(ms),默认 5 分钟。 */
  timeoutMs?: number;
}

export interface CapturedAuth {
  cookie: string;          // "name=value; name=value" 形式,可直接用作 HTTP Cookie 头
  username?: string;
  /** 用于诊断:浏览器路径、版本 */
  browserInfo?: { name: string; path: string; version?: string };
}

/** core 内部 helper,不直接 export 给前端;前端通过 LoginFlow 间接使用。 */
export interface BrowserPageHandle {
  url(): Promise<string>;
  cookies(): Promise<Array<{ name: string; value: string; domain: string }>>;
  evaluate<T>(fn: () => T): Promise<T>;
}
```

`LoginFlow.run`:

```ts
class LoginFlow {
  constructor(private deps: {
    capture: BrowserLoginCapture;
    credentialStore: CredentialStore;
    credChecker: CredentialChecker;
    logger?: LoggerBackend;
  }) {}
  async run(config: LoginConfig): Promise<{ ok: true; username?: string } | { ok: false; reason: string }>;
}
```

编排逻辑:`capture.capture(config)` → 写入 store(临时) → `credChecker.check(platform)` 校验 → valid 保留写入,expired/unknown 删除并返回失败。

### D3:浏览器检测

`PlaywrightBrowserLogin` 启动时按以下顺序探测:
1. `chromium`(playwright-core 自带 channel,但本变更**不下载** chromium,跳过此步)
2. `chrome`(系统 Chrome,launchPersistentContext + channel: 'chrome')
3. `msedge`(系统 Edge)
4. `chrome-beta` / `chrome-canary` / Brave(尝试 executablePath 显式路径)

发现任一即停止;全失败抛 `BROWSER_NOT_FOUND` 错误,前端按 D6 降级。

### D4:登录完成信号

LeetCode CN:
- `loginUrl: 'https://leetcode.cn/accounts/login/'`
- `ready.urlPattern: /^https:\/\/leetcode\.cn\/(?:problemset|u\/|premium)/` — 登录后会跳转到 problemset
- `ready.cookieName: 'LEETCODE_SESSION'` — 双重保险
- `extractUsername`:登录完成后导航到 `/u/me/`,从 URL 或 DOM 抽取
- `cookieDomain: '.leetcode.cn'`

页面轮询频率 500ms,任一信号触发即视为登录成功。

HDOJ(本变更先定义,实现可延后到独立 change):
- `loginUrl: 'http://acm.hdu.edu.cn/userloginex.php'`
- `ready.cookieName: 'PHPSESSID'`(注:这个 cookie 是会话 token,不在登录前/后,**需要额外信号**:`ready.urlPattern: /control_panel\.php/` 登录成功跳转)
- `extractUsername`:从 `control_panel.php` DOM 抽

### D5:用户体验流程

```
$ oja login leetcode-cn
[oja] 启动浏览器(系统 Chrome)...
[oja] 已打开 https://leetcode.cn/accounts/login/,请在浏览器内完成登录(支持账号密码/微信扫码)。
[oja] 等待登录完成... (按 Ctrl+C 取消并切换为粘贴模式)
[oja] 检测到 LEETCODE_SESSION,正在校验...
✓ 登录成功(用户名:foo123)
$
```

VSCode 端:命令触发后弹 Notification `'正在启动浏览器,请在弹出的浏览器内登录'`,登录完成后状态栏更新。

### D6:降级策略

启动浏览器失败的原因(系统无 Chrome/Edge/Brave、Linux 缺 X server、playwright-core 加载失败)统一映射到"自动登录不可用",返回让上层走粘贴流程:

CLI:
```
[oja] 自动登录不可用(未检测到系统 Chrome/Edge/Brave),改用粘贴模式...
LEETCODE_SESSION: ____
csrftoken: ____
```

VSCode:Notification `'未检测到可用浏览器,改为手动粘贴'`,然后弹 QuickInput 收 cookie。

`oja login --manual` flag 直接跳过浏览器,与降级一致。

### D7:超时与中止

`timeoutMs` 默认 300_000(5 分钟)。超时后浏览器进程被 kill,流程返回失败,前端可建议降级或重试。

用户在终端 Ctrl+C 时:CLI 监听 SIGINT,优雅关闭浏览器进程后退出码 130(已有规约)。

VSCode 端:扩展提供"取消登录"命令(进度条上挂取消按钮),点击后调 `BrowserLoginCapture.cancel()`,关闭浏览器。

### D8:安全考虑

- 浏览器以 **headed**(可见)启动,用户能看到自己在哪个浏览器里登录,避免 phishing 担忧
- 浏览器使用 `userDataDir = <临时目录>`(每次新建,**不复用**用户的现有浏览器配置),登录完成后**保留浏览器临时目录**直到 capture 结束,然后删除。这样用户不需要担心"我的浏览器多了一个未知 profile"
- cookie 抽取后通过 `CredentialStore.set` 进入 keytar / file fallback,与现有路径一致
- 不打印 cookie value 到任何日志(只打印名字)

### D9:测试策略

- core 单测:`LoginFlow` 用 mock `BrowserLoginCapture` 与 mock `CredentialChecker`,覆盖 happy / capture 失败 / 校验失败 / 总超时
- CLI 单测:`PlaywrightBrowserLogin` 用 mock `playwright-core` 模块(注入测试桩,验证浏览器探测顺序、cookie 转换格式、用户名抽取)
- VSCode 单测:同 CLI
- 真实浏览器测试:留给手工 QA(对 LeetCode CN / HDOJ 各跑一次)

### D10:openExternal 不行的原因

VSCode `vscode.env.openExternal` 把 URL 交给系统默认浏览器,但**扩展拿不到那个浏览器的 context**(浏览器进程独立于扩展)。无法监听导航完成、读 cookie、抽用户名。所以 VSCode 端也必须用 playwright-core 自己启浏览器(用户体验上看起来一样,只是底层不同)。

## Risks / Trade-offs

- **playwright-core 加载失败 / 系统无 Chromium 系浏览器** → 降级到粘贴(D6)。Linux 服务器 / Docker 用户尤其注意。
- **LeetCode 风控识别 playwright** → 自动化浏览器有概率被 Cloudflare / 滑块挑战拦截。Mitigation:浏览器以 headed 启动,用户在浏览器内可手动过验证;不试图绕过反爬。
- **首次启动慢** → 启动系统 Chrome 需要 1-3 秒,体验上会有 lag。Mitigation:打印 `[oja] 启动浏览器...` 与进度提示。
- **macOS 系统权限弹窗** → playwright 控制 Chrome 时 macOS 可能提示"oja 想控制 Google Chrome",用户首次需点同意。Mitigation:README 说明,且这只发生一次。
- **临时 userDataDir 占空间** → playwright 创建的 user data 包含 cache,登录完成立即清理。
- **HttpOnly cookie 在 playwright 下能读取** → 这是依赖 playwright 是真浏览器的特性。如果未来 LeetCode 加了额外保护(如 SameSite=Strict + 跨域请求拒绝),可能影响 OJ-Agent 用 cookie 出网的能力,但与本变更无关。
- **超时(5 分钟)对慢用户偏短** → 可配置 `auth.browserLoginTimeoutMs`。

## Migration Plan

- 第一批合入:core 的接口与 LoginFlow + 单测
- 第二批:CLI PlaywrightBrowserLogin 实现 + `oja login` 命令重写 + 降级测试
- 第三批:VSCode 端同样实现
- M2 时复用本接口为 Codeforces / 洛谷写 LoginConfig

回滚:`oja login --manual` / VSCode "手动粘贴 Cookie" 命令保留;若新流程出问题,用户可显式走老路径,不阻塞使用。

## Open Questions

- 是否要支持"登录一次后下次直接复用 playwright userDataDir"以避免重复登录?——倾向**否**,保留 cookie 即可重新登录;cache user data 不安全。
- 是否要把 `playwright-core` 升为 `dependencies` 而非 `optionalDependencies`?——倾向**否**,保持可选,降低安装失败概率。
- HDOJ 的 LoginConfig 是否在本 change 实现?——倾向**仅定义不实现**(HDOJ 现状的"账号密码 form POST"已经够用,等 M2 时统一切到浏览器流程)。

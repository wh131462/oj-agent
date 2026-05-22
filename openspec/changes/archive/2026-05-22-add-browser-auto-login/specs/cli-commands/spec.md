## MODIFIED Requirements

### Requirement: `oja login`

`oja login <platform>` SHALL 默认使用浏览器自动登录:

- 启动 `PlaywrightBrowserLogin`(基于 `playwright-core`)
- 自动检测系统 Chrome / Edge / Brave / Chromium,顺序探测
- 找到任一可用浏览器即启动 headed 实例,加载平台登录页
- 用户在浏览器内人工登录,CLI 监听导航/cookie 变化,完成后自动抽取
- `LoginFlow` 校验通过后写入 `CredentialStore`

flag:
- `--manual`:跳过浏览器,走粘贴流程(原 M1 行为)
- `--cookie <raw>`:直接传入 cookie,跳过交互(原 M1 行为)
- `--browser <name>`:指定优先尝试的浏览器(`chrome` / `edge` / `brave` / `chromium`)
- `--browser-timeout-ms <n>`:浏览器登录总超时,默认 300000

降级路径:
- 系统未安装任何 Chromium 系浏览器 → CLI 自动 fallback 到粘贴流程,首先打印一行警告
- `playwright-core` 加载失败(未安装) → 同上 fallback
- 用户 Ctrl+C 中止浏览器流程 → CLI 提示"已取消,可使用 `oja login --manual` 走粘贴模式"后退出 130

#### Scenario: 自动登录成功

- **WHEN** 用户执行 `oja login leetcode-cn`,系统有 Chrome,在浏览器内 30 秒内完成登录
- **THEN** stderr 流式输出 `启动浏览器... → 等待登录... → ✓ 登录成功(用户名: foo)`,退出码 0,凭证已落 keytar/file

#### Scenario: 显式 manual 跳过自动

- **WHEN** 执行 `oja login leetcode-cn --manual`
- **THEN** 直接走 M1 粘贴流程,不启动任何浏览器

#### Scenario: 浏览器找不到自动降级

- **WHEN** 系统无 Chromium 系浏览器,执行 `oja login leetcode-cn`
- **THEN** stderr 输出 `[oja] 自动登录不可用(未检测到 Chrome/Edge/Brave),改用粘贴模式...`,然后进入粘贴流程

#### Scenario: --cookie 仍直通

- **WHEN** `oja login leetcode-cn --cookie 'LEETCODE_SESSION=a; csrftoken=b'`
- **THEN** 不启动浏览器,直接调 `CredentialChecker.check` 校验后写入

#### Scenario: 用户中止

- **WHEN** 浏览器已启动,用户按 Ctrl+C
- **THEN** CLI 关闭浏览器进程,清理临时 userDataDir,退出码 130,stderr 输出"已取消"

### Requirement: 退出码语义(扩展)

CLI MUST 按下表使用退出码,与 M1 已落地的 cli-commands 规约兼容并新增浏览器登录路径:

| 码 | 含义 |
|---|---|
| 0 | 登录成功 / 命令成功 |
| 1 | 登录失败(凭证校验未过、捕获失败) |
| 3 | 环境错误:浏览器找不到且 `--manual` 也失败 |
| 130 | SIGINT 取消 |

退出码 3 之外的环境失败 MUST 自动降级而非直接退出。

#### Scenario: 浏览器与粘贴双失败退 3

- **WHEN** `--manual` 流程也失败(用户多次输入空 cookie)
- **THEN** 退出码 3

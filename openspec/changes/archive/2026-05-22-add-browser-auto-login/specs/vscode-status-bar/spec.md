## MODIFIED Requirements

### Requirement: QuickPick 入口

`ojAgent.statusBar.openQuickPick` SHALL 弹 QuickPick,选项 MUST 按"安全先于便利"的原则分组:

**功能区(顶部):**
- `登录平台(浏览器自动)` — 等同 `ojAgent.auth.login`
- `登录平台(手动粘贴 Cookie)` — 等同 `ojAgent.auth.loginManual`
- `设置工作区根目录` — 等同 `ojAgent.workspace.setRoot`
- `打开 OutputChannel`
- `查看工具链状态` — 等同 `ojAgent.judge.openToolchain`

**Separator(`vscode.QuickPickItemKind.Separator`,label `账号管理`):** 在功能区与"账号管理"区之间 MUST 插入分隔符,提供视觉断层。

**账号管理区(底部):**
- `重新登录` — 等同 `ojAgent.auth.relogin`
- `登出平台` — 等同 `ojAgent.auth.logout`

`登出平台` MUST 是列表最后一项,与功能区有 separator + 至少 1 个其他项的距离,以避免上下方向键 / 鼠标快速点击导致误触。

#### Scenario: 登出位于列表底部

- **WHEN** 用户打开 QuickPick
- **THEN** "登出平台"是列表最后一个 item
- **AND** "登出平台"与"登录平台(浏览器自动)"之间至少有 5 个其他项 + 1 个 Separator

#### Scenario: 登录入口顶部曝光

- **WHEN** 用户打开 QuickPick(键盘聚焦默认在第 1 项)
- **THEN** 第 1 项是"登录平台(浏览器自动)"

#### Scenario: 手动登录可发现

- **WHEN** 用户打开 QuickPick
- **THEN** "登录平台(手动粘贴 Cookie)"在浏览器自动登录之后立刻可见,作为降级路径

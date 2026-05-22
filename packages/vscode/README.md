# OJ-Agent VSCode 扩展

面向多 OJ 平台的 VSCode 插件：在编辑器内统一完成 **拉取题目 → 本地测试 → 在线提交**，并内置 AI 解题助手。

> **状态：** M1（LeetCode CN + HDOJ 双平台闭环）

## 功能概览（M1）

### 题库 TreeView (`OJ-Agent: 题库`)
- 活动栏 → OJ-Agent → "题库" 视图
- 两层结构：平台 → 题目；登录后展开可见列表
- 工具栏：搜索 / 难度筛选 / 标签筛选 / 上一页 / 下一页 / 刷新
- 右键题目：拉取到本地、浏览器中打开、复制题目 ID

### 题面 Webview (`ojAgent.problemView`)
- markdown-it + KaTeX，离线公式渲染
- 工具栏：运行 / 提交 / 刷新 / 打开代码 / 浏览器中打开
- AI 入口：解释错因 / 思路 / 题解 / 解释代码（未配置 AI Profile 时按钮 disable）

### 本地测试结果面板 (`ojAgent.judgeResult`)
- 顶部 summary：`X / Y AC, total Zms`，可一键重跑
- 每个用例显示 verdict / 耗时 / 期望 / 实际 / unified diff
- 失败用例右上角"AI · 解释错因"按钮，自动注入 `caseIndex`

### 状态栏
- `$(rocket) OJ-Agent` 常驻；提交时切到 `$(sync~spin) 提交中... → Judging... → AC 120ms`
- 点击弹 QuickPick（登录 / 登出 / 重新登录 / 设置工作区根目录 / 打开 OutputChannel / 工具链状态）

### 登录
- **默认浏览器自动登录**:命令 `OJ-Agent: 登录 OJ 平台(浏览器自动)` 拉起系统 Chrome / Edge / Brave 任一,用户在浏览器内人工完成登录,扩展自动抓 cookie + 用户名
- **手动粘贴**:命令 `OJ-Agent: 登录 OJ 平台(手动粘贴 Cookie)` 走 QuickInput / Webview 流程(M1 行为)
- 浏览器找不到 / `playwright-core` 未装 → 自动降级到手动粘贴
- macOS 首次会弹"扩展想控制 Chrome"对话框,需要点同意(只一次)
- 凭证仅保存在 VSCode SecretStorage,与 AI Key 命名空间隔离

## 配置项

```jsonc
{
  // OJ
  "ojAgent.workspace.root": "",                       // 工作区根；空 = ~/oj-agent-workspace
  "ojAgent.platforms.enabled": ["leetcode-cn", "hdoj"],
  "ojAgent.http.proxy": "",
  "ojAgent.http.rateLimit.leetcode-cn": 30,
  "ojAgent.http.rateLimit.hdoj": 60,
  "ojAgent.judge.timeoutMs": 3000,
  "ojAgent.submission.minIntervalMs": 5000,
  "ojAgent.submission.pollTimeoutMs": 60000,
  "ojAgent.submission.confirmBeforeSubmit": true,
  "ojAgent.ui.defaultLang": "cpp",                    // cpp | python3 | java | javascript

  // AI（沿用既有）
  "ojAgent.ai.activeProfileId": "",
  "ojAgent.ai.privacy.redact": true
}
```

## 首次使用指引

1. `Cmd+Shift+P` → `OJ-Agent: 设置工作区根目录`，选一个本地目录
2. `OJ-Agent: 登录 OJ 平台` 登录 LeetCode CN 或 HDOJ
3. 活动栏点击 OJ-Agent → 展开题库 → 找一道题 → 右键 → 拉取到本地
4. 题面 Webview 打开后，编辑器侧打开 `solution.cpp` 编写代码
5. 在题面工具栏点击 **运行** → 本地测试面板显示用例结果
6. 通过后点 **提交**，状态栏会显示提交进度直至最终 verdict
7. 若 WA，点失败用例右侧 **AI · 解释错因**（需先在 AI Profiles 中配置一个 Profile）

## 命令清单（M1 新增）

| 命令 | 说明 |
| --- | --- |
| `ojAgent.platform.pullByUrl` | 粘贴 URL 拉题 |
| `ojAgent.platform.pullProblem` | 从 TreeView 右键拉题 |
| `ojAgent.platform.openInBrowser` | 浏览器中打开 |
| `ojAgent.platform.refreshProblem` | 刷新本地题面 |
| `ojAgent.platform.addCustomCase` | 添加自定义用例 |
| `ojAgent.platform.copyProblemId` | 复制题目 ID |
| `ojAgent.judge.runAll` | 本地测试·全部用例 |
| `ojAgent.judge.runCase` | 本地测试·单用例 |
| `ojAgent.judge.openToolchain` | 查看工具链状态 |
| `ojAgent.submission.submit` | 提交当前题解 |
| `ojAgent.submission.openLatest` | 打开最近一次提交结果 |
| `ojAgent.auth.login / logout / relogin` | 登录管理 |
| `ojAgent.workspace.setRoot` | 设置工作区根目录 |
| `ojAgent.statusBar.openQuickPick` | 状态栏快捷面板 |
| `ojAgent.openOutputChannel` | 打开 OJ-Agent OutputChannel |

## 构建与开发

```sh
pnpm install
pnpm --filter oj-agent build
pnpm --filter oj-agent test     # 纯 mock 单测
# 在 VSCode 内 F5 启动 Extension Host 调试
```

## 已知限制

- LeetCode CN Cookie 必须手动粘贴（HttpOnly 限制）
- HDOJ Webview 登录受 VSCode 跨域 iframe 限制，60s 后自动降级到账号密码
- 不支持 watch 模式（保存即测试），需手动触发运行
- `vsce package` 与 monorepo `workspace:*` 依赖打包冲突待 M3 解决

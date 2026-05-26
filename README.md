# OJ-Agent

一个结合 Agent 能力、面向多 OJ 平台的一体化学习工作流。既支持在 VSCode 内统一完成「题目拉取 → 本地测试 → 在线提交」，也支持纯 CLI 方式接入并完成整个流程。

> 虽然平台提供了 AI Agent 能力，但是初心仅仅是为了更好的学习解惑。算法的学习需要扎实的知识基础和坚持不懈的练习，希望大家都能在练习的过程中变得更强。

---

## 支持平台

当前内置 6 个主流 OJ 平台适配器，欢迎提交 PR 共建：

| 平台 | id | 登录方式 | 备注 |
| --- | --- | --- | --- |
| LeetCode CN | `leetcode-cn` | 浏览器自动 / Cookie 粘贴 | HttpOnly Cookie，无法 JS 抓取 |
| HDOJ | `hdoj` | 账号密码 / 浏览器自动 | — |
| Codeforces | `codeforces` | 浏览器自动 / Cookie 粘贴 | — |
| 洛谷 (Luogu) | `luogu` | 浏览器自动 / Cookie 粘贴 | — |
| POJ | `poj` | 账号密码 | — |
| 蓝桥云课 | `lanqiao` | JWT | 题目详情/提交需 JWT，适配器 `degraded` 字段已标注 |

各平台能力矩阵可通过 `oja platforms` 命令查看。

### 扩展平台

OJ-Agent 采用统一的 `PlatformAdapter` 接口，新增平台只需实现一组核心方法（列题 / 看题 / 提交 / 轮询 / 登录），并在注册表登记即可同时被 CLI 与 VSCode 使用。

完整步骤、接口契约、错误处理约定与 6 个已有平台的参考实现，见 [`docs/platform-extension.md`](docs/platform-extension.md)。

## 支持语言

C / C++ / Python3 / Java / JavaScript。题面 Webview 与本地评测面板支持题目级语言切换。

---

## VSCode 扩展

在编辑器内提供完整的 OJ 工作流，并内置 AI 助手。

### 功能

- **题库 TreeView**：活动栏 → OJ-Agent → 「题库」视图。平台 → 题目两层结构，登录后展开可见列表；工具栏支持搜索 / 难度筛选 / 标签筛选 / 翻页 / 刷新；右键题目可拉取到本地、浏览器打开、复制题目 ID、显示题目目录、添加自定义用例。
- **题面 Webview**：基于 markdown-it + KaTeX 的离线渲染，工具栏含运行 / 提交 / 刷新 / 打开代码 / 浏览器打开；支持题目级语言切换；AI 入口含解释错因、生成思路、生成题解、解释代码。
- **本地评测结果面板**：顶部 summary 一键重跑；每个用例显示 verdict / 耗时 / 期望 / 实际 / unified diff；失败用例可一键唤起「AI · 解释错因」。
- **状态栏**：常驻 OJ-Agent 图标，提交时显示判题进度直至最终 verdict；点击弹 QuickPick（登录 / 登出 / 设置工作区 / 打开 OutputChannel / 工具链状态）。
- **登录**：默认浏览器自动登录，用户在系统浏览器内人工完成登录后扩展自动抓取 Cookie；浏览器或 `playwright-core` 缺失时降级为手动粘贴。凭证仅存 VSCode SecretStorage，与 AI Key 命名空间隔离。
- **本地文件与自定义用例**：题库树暴露题目目录下的源码文件与用例文件，支持新增 / 删除自定义用例。
- **AI 助手面板**：多会话、对话历史持久化。

### 使用

1. 命令面板 → **OJ-Agent: 设置工作区根目录**，选一个本地目录
2. **OJ-Agent: 登录 OJ 平台(浏览器自动)** 登录目标平台
3. 活动栏点击 OJ-Agent → 展开题库 → 选题 → 右键 → **拉取到本地**
4. 题面 Webview 打开后，编辑器侧打开 `solution.<lang>` 编写代码
5. 题面工具栏 → **运行**，本地测试面板显示用例结果
6. 通过后点 **提交**，状态栏显示判题进度
7. 若 WA，点失败用例的 **AI · 解释错因**（需先配置 AI Profile）

### AI 助手

四类操作：解释错因 / 生成思路 / 生成题解 / 解释当前代码。

- **双协议**：OpenAI Chat Completions 与 Anthropic Messages，运行时切换
- **端点兼容**：除官方端点外，可接入任意 OpenAI/Anthropic 兼容端点 —— Azure OpenAI、DeepSeek、OpenRouter、Ollama、Claude Code Gateway 等
- **多 Profile**：保存多套配置（如「日常题便宜模型 / 难题强模型」），命令 **OJ-Agent: 切换 AI 模型 Profile** 一键切换
- **安全**：API Key 仅存 SecretStorage，绝不写入 `settings.json`
- **隐私**：默认对发送给 AI 的上下文执行脱敏（剥离 `username` / `submissionId` / `Cookie` / `Authorization`），可关闭
- **限速**：默认 20 req/min，可调

配置流程：命令面板 → **OJ-Agent: 打开 AI 模型设置** → 选预设或填自定义 `baseUrl` + `model` → 填 API Key → 测试连接。

### 主要命令

| 命令 | 说明 |
| --- | --- |
| OJ-Agent: 粘贴 URL 拉取题目 | 直接粘贴题目链接拉取 |
| OJ-Agent: 拉取到本地 | 从 TreeView 右键拉题 |
| OJ-Agent: 添加自定义用例 | 题面或题库树添加用例 |
| OJ-Agent: 本地测试 · 全部用例 / 单用例 | 本地编译运行并 diff |
| OJ-Agent: 提交当前题解 | 在线提交并轮询结果 |
| OJ-Agent: 登录 / 登出 / 重新登录 OJ 平台 | 凭证管理 |
| OJ-Agent: 打开 AI 助手面板 | 多会话 AI 对话 |
| OJ-Agent: 切换 / 新建 / 编辑 / 删除 AI Profile | AI Profile 管理 |
| OJ-Agent: 查看工具链状态 | 探测编译器 / 解释器 |
| OJ-Agent: 设置工作区根目录 | 切换题库工作区 |

完整命令清单见 `packages/vscode/package.json` 的 `contributes.commands`。

### 常用配置

可在 VSCode 设置中以 `ojAgent.` 前缀搜索，按需调整：

- **工作区**：`workspace.root`（空则用 `~/oj-agent-workspace`）、`platforms.enabled`、`ui.defaultLang`
- **网络**：`http.proxy`、`http.timeoutMs`、`http.requestIntervalMs`、各平台 `http.rateLimit.<platform>`
- **评测**：`judge.timeoutMs`、`lang.<lang>.compile/run`（自定义编译运行模板）
- **提交**：`submission.minIntervalMs`、`submission.pollTimeoutMs`、`submission.confirmBeforeSubmit`
- **AI**：`ai.activeProfileId`、`ai.rateLimit.perMinute`、`ai.privacy.redact`

---

## CLI（`oja`）

无需 VSCode 也可完成完整流程，适合终端、SSH 环境或脚本中使用。

### 功能

- 平台登录（浏览器自动 / 手动粘贴 / 账号密码）
- 题库浏览与拉题（URL 或 `platform/id` 短形式）
- 本地编译运行 + diff 对拍
- 在线提交 + 流式判题
- 凭证存储自动选择钥匙串或本地文件回退

### 命令一览

| 命令 | 说明 |
| --- | --- |
| `oja login <platform>` | 登录，默认浏览器自动；`--manual` 走粘贴；`--cookie` 直接传 Cookie；`--browser <name>` 指定浏览器 |
| `oja logout <platform>` | 注销 |
| `oja status` | 查看登录状态、配置、工具链 |
| `oja platforms` | 查看平台能力矩阵 |
| `oja list <platform>` | 列出题库 |
| `oja pull <ref>` | 拉题到工作区（URL 或 `platform/id`） |
| `oja test [path]` | 本地编译运行 + diff 对拍 |
| `oja submit [path]` | 在线提交 + 流式判题 |
| `oja config get/set` | 读写 TOML 配置 |
| `oja toolchain` | 探测本地编译器 / 解释器 |

全局选项：`-h/--help`、`-v/--version`、`--json`、`--quiet`、`--verbose`、`--no-color`、`--config <path>`。

### 使用

1. `oja login leetcode-cn` 登录目标平台
2. `oja pull leetcode-cn/two-sum` 拉题到工作区
3. 在题目目录下编写代码后 `oja test` 本地评测
4. 通过后 `oja submit` 在线提交

### 浏览器自动登录

默认通过 `playwright-core` 拉起系统浏览器（Chrome / Edge / Brave / Chromium），用户人工完成登录后自动抓取 Cookie 与用户名。降级策略：未检测到 Chromium 系浏览器 / 未装 `playwright-core` → fallback 到粘贴流程；Ctrl+C 取消 → 退出码 130，提示用 `--manual`。

macOS 首次会弹「oja 想控制 Google Chrome」系统对话框（只一次）。浏览器以可见模式启动，使用临时 `userDataDir`，完成后清理，不复用用户日常浏览器配置；cookie value 不写入任何日志。

### 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 业务失败（WA / 网络 / 未登录 / 限速等） |
| 2 | 用法错误 |
| 3 | 环境错误（toolchain 缺失等） |
| 130 | SIGINT |

### 配置与凭证

- 配置文件：Unix `~/.config/oj-agent/config.toml`、Windows `%APPDATA%/oj-agent/config.toml`；也支持 `--config <path>` 或环境变量 `OJ_AGENT_CONFIG`。字段对齐 VSCode `ojAgent.*` 配置项
- 凭证存储：首选 `keytar`（macOS Keychain / Windows Credential Manager / Linux Secret Service），回退 `~/.config/oj-agent/secrets.json`（权限 0600）
- OJ Cookie（`oj.cookie.*`）与 AI Key（`ai.apiKey.*`）严格隔离

---

## 安全与隐私

- 所有 OJ 平台 Cookie / 账号密码、AI API Key 均仅落地于操作系统钥匙串或 VSCode SecretStorage，从不写入 `settings.json` 或仓库文件
- OJ 凭证与 AI 凭证使用独立命名空间，互不串读
- AI 上下文默认脱敏 `username` / `submissionId` / `Cookie` / `Authorization` 等敏感字段
- 浏览器自动登录使用临时 `userDataDir`，完成后清理，不污染用户日常浏览器配置

---

## 贡献

欢迎提交 PR 共建新平台适配器或完善现有能力。贡献规范见 `CONTRIBUTING.md`，需求与里程碑见 `docs/PRD.md`，平台接入调研见 `docs/research.md`。

## 许可

MIT

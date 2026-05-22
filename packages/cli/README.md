# @oj-agent/cli (`oja`)

OJ-Agent 命令行前端。M1 范围:LeetCode CN 与 HDOJ 两个平台的完整闭环(登录 → 浏览 → 拉题 → 测试 → 提交)。

## 安装

```bash
# monorepo 开发
pnpm install
pnpm -r build
node packages/cli/dist/index.js --version

# 全局安装(M3 发布到 npm 后)
npm install -g @oj-agent/cli
```

> **注意**:首启动时如果未检测到系统钥匙串(`keytar` 原生模块未构建),凭证将自动落到 `~/.config/oj-agent/secrets.json`(`0600` 权限)并提示。`pnpm approve-builds` 可启用 keytar 原生构建。

## 浏览器自动登录

`oja login <platform>` 默认通过 `playwright-core` 拉起系统浏览器(Chrome / Edge / Brave / Chromium 任一),用户在浏览器内人工完成登录后,CLI 自动抓取 cookie 与用户名,无需 DevTools 复制粘贴。

```bash
oja login leetcode-cn          # 默认浏览器自动
oja login leetcode-cn --manual # 显式走粘贴流程(M1 行为)
oja login leetcode-cn --cookie 'LEETCODE_SESSION=...; csrftoken=...'  # 直接传整段 cookie
oja login leetcode-cn --browser chrome           # 优先用 Chrome
oja login leetcode-cn --browser-timeout-ms 600000 # 自定义超时
```

**前提**:系统装有 Chrome / Edge / Brave / Chromium 任一,且 `playwright-core` 已安装(`pnpm install` 默认会装,`optionalDependencies`)。

**降级**:
- 系统未检测到 Chromium 系浏览器 → 自动 fallback 到粘贴流程
- `playwright-core` 未装 → 同上 fallback
- 用户 Ctrl+C 取消浏览器 → 退出码 130,提示用 `--manual`

**macOS 注意**:首次启动可能弹出 "oja 想控制 Google Chrome" 系统对话框,需要点同意。这只发生一次。

**安全**:
- 浏览器以可见模式启动,使用临时 `userDataDir`(完成后自动清理),不复用用户已有浏览器配置
- cookie value 不写入任何日志,只记 cookie name

## 命令一览

| 命令 | 说明 |
|---|---|
| `oja login <platform>` | 登录(`leetcode-cn` 粘贴 Cookie / `hdoj` 账号密码) |
| `oja logout <platform>` | 注销 |
| `oja status` | 查看登录状态、配置、工具链 |
| `oja list <platform>` | 列出题库 |
| `oja pull <ref>` | 拉题到工作区(URL 或 `platform/id` 短形式) |
| `oja test [path]` | 本地编译运行 + diff 对拍 |
| `oja submit [path]` | 在线提交 + 流式判题 |
| `oja config get/set` | 读写 TOML 配置 |
| `oja toolchain` | 探测编译器 / 解释器 |

全局选项:`-h/--help`、`-v/--version`、`--json`、`--quiet`、`--verbose`、`--no-color`、`--config <path>`。

## 退出码

- `0` 成功
- `1` 业务失败(WA / 网络 / 未登录 / 限速)
- `2` 用法错误
- `3` 环境错误(toolchain 缺失等)
- `130` SIGINT

## 快速上手

```bash
# 1) 登录 LeetCode CN(从浏览器 DevTools 复制 cookie 后)
oja login leetcode-cn

# 2) 拉一道题
oja pull leetcode-cn/two-sum
# 输出工作区路径,如 ~/oj-agent-workspace/leetcode-cn/1-two-sum-2026-05-22/

# 3) 写代码后本地测试
cd ~/oj-agent-workspace/leetcode-cn/1-two-sum-2026-05-22/
oja test

# 4) 提交
oja submit
```

## 配置文件

默认路径:`~/.config/oj-agent/config.toml`(Unix)或 `%APPDATA%/oj-agent/config.toml`(Windows)。
也支持 `--config <path>` 或 `OJ_AGENT_CONFIG` 环境变量。

字段对齐 VSCode `ojAgent.*` 配置项,详见 `oja config get` 列出的快照。

## 凭证存储

- 首选 `keytar`(macOS Keychain / Windows Credential Manager / Linux Secret Service)
- 回退 `~/.config/oj-agent/secrets.json`(0600 权限)
- OJ Cookie 使用 `oj.cookie.<platform>` 命名空间,与 AI API Key(`ai.apiKey.*`)严格隔离

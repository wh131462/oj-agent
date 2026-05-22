# OJ-Agent

面向多 OJ 平台的 VSCode 插件：在编辑器内统一完成**题目拉取 → 本地测试 → 在线提交**的工作流。

支持平台：LeetCode CN、HDOJ、Codeforces、洛谷、POJ、蓝桥云课。

## AI 助手

内置 AI 解题与解释能力（解释错因 / 生成思路 / 生成题解 / 解释代码），通过 **API Key** 接入：

- **协议支持**：OpenAI Chat Completions 与 Anthropic Messages 双协议，运行时切换。
- **端点兼容**：除官方端点外，可接入任意 OpenAI/Anthropic 兼容端点 —— Azure OpenAI、DeepSeek、OpenRouter、Ollama (OpenAI-compat)、Claude Code Gateway 等。
- **多 Profile**：可保存多个 Profile（例如「日常题用便宜模型 / 难题用强模型」），通过命令 `OJ-Agent: 切换 AI 模型 Profile` 一键切换。
- **安全**：API Key 仅存 VSCode `SecretStorage`，绝不写入 `settings.json`；与 OJ 平台凭证命名空间隔离。
- **隐私**：默认对发送给 AI 端点的上下文执行脱敏（剥离 `username` / `submissionId` / `Cookie` / `Authorization`）；可在设置中关闭。
- **限速**：默认 20 req/min，可调；超额时拒绝并提示等待。

### 快速开始

1. 命令面板执行 `OJ-Agent: 打开 AI 模型设置`。
2. 选择常用预设（OpenAI gpt-4o、Claude Sonnet 4.6 等）或填写自定义 `baseUrl` + `model`。
3. 填入 API Key 保存 → 点击「测试连接」确认连通。
4. 状态栏会显示 `AI: <Profile 名>`，之后在题面 Webview 或本地测试面板使用四类 AI 操作。

## 文档

- [产品需求文档 (PRD)](docs/PRD.md)
- [平台接入调研报告](docs/research.md)

> 当前处于规划阶段，详见 PRD。

## Why

PRD 原本将产品形态限定为 VSCode 插件。复盘后判断：核心价值是"多 OJ 统一抓题/测试/提交的能力"本身，而不是 VSCode 集成。绑定单一 IDE 会让产品错过 Cursor / Zed / Neovim / 纯终端用户，也无法在 CI、脚本、其他 Agent 等组合场景中复用。

将仓库改造为 Monorepo（`core` + `cli` + `vscode` 三个包），核心引擎可被任意前端复用，VSCode 退化为薄壳，并新增 CLI 作为第一公民。本提案**仅做架构骨架与既有代码迁移**，不实现任何 OJ 平台适配器或 CLI 业务命令——这些会在新架构稳定后以单独 change 推进。

## What Changes

- **新增** `pnpm` workspaces 根骨架：`pnpm-workspace.yaml` / `tsconfig.base.json` / 私有 root `package.json`。
- **新增** `packages/core`（`@oj-agent/core`）：零 VSCode 依赖；接收从 `src/core/ai/*`、`src/core/http/*` 整体下沉的现有代码；新增 `platform/adapter.ts` 仅含 `PlatformAdapter` 等类型契约，不含实现。
- **新增** `packages/cli`（`@oj-agent/cli`）：`bin: oja` 入口骨架，仅打印 help / version，用于验证分层链路打通。
- **新增** `packages/vscode`：接收从 `src/extension.ts`、`src/extension/*` 迁移过来的全部 VSCode 侧代码；继续打包发布到 Marketplace。
- **修改** 所有现有 import：从 `../core/ai/...` 改为 `@oj-agent/core` barrel 导入。
- **修改** 测试：按被测代码归属拆分到各包 `test/` 目录，根脚本走 `pnpm -r test`。
- **修改** `.vscode/launch.json`、`.vscode/tasks.json`：路径指向新包位置。
- **不变** 现有 14 条 VSCode contributes.commands、AI 业务逻辑、PRD 文档。

## Capabilities

### New Capabilities

- `monorepo-layout`: 定义仓库的 Monorepo 分层结构、包边界、依赖方向（`vscode → core`、`cli → core`，禁止反向）、构建与测试编排规范。

### Modified Capabilities

- `ai-assistant`、`model-provider`：实现位置从 `src/core/ai/` 迁移至 `packages/core/src/ai/`，对外行为零变化。

## Non-goals

- 不实现任何 OJ 平台适配器（LeetCode/HDOJ/Codeforces/洛谷/POJ/蓝桥）。
- 不实现 CLI 任何业务子命令（pull/test/submit/login/browse）。
- 不实现 CLI 侧的 `SecretBackend` 具体实现（如 keytar 绑定）。
- 不动 PRD 文档（架构形态变更将由后续单独 change 反映到 PRD）。
- 不解决 `vsce package` 在 Monorepo 下打包 workspace 依赖的问题（推迟到 M3 发布阶段）。

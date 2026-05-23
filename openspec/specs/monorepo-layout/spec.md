# monorepo-layout Specification

## Purpose

定义 oj-agent 仓库的 Monorepo 三包结构、依赖方向、CLI 入口与统一构建编排规范,保证 `@oj-agent/core` 引擎平台无关,可被 CLI 与 VSCode 等多前端复用。

## Requirements

### Requirement: 仓库采用 pnpm Monorepo 三包结构

仓库根目录下 MUST 包含 `packages/core`、`packages/cli`、`packages/vscode` 三个独立包,通过 `pnpm-workspace.yaml` 管理。

#### Scenario: 包边界

- **WHEN** 开发者新增功能代码
- **THEN** MUST 明确归属到三个包之一
- **AND** 跨包引用 MUST 通过 `@oj-agent/core` 显式依赖,禁止使用相对路径穿越包边界

### Requirement: 依赖方向单向收敛于 core

`packages/cli` 与 `packages/vscode` SHALL 可以依赖 `@oj-agent/core`;`@oj-agent/core` MUST NOT 反向依赖任何前端包。

#### Scenario: core 包零 VSCode 依赖

- **WHEN** 检查 `packages/core/package.json` 与 `packages/core/src/`
- **THEN** MUST NOT 出现 `vscode`、`@types/vscode` 字样
- **AND** MUST NOT 出现任何 `vscode.*` API 调用

#### Scenario: 平台无关的抽象

- **WHEN** core 需要访问 IDE / 操作系统能力(如配置存储、密钥存储、文件系统)
- **THEN** MUST 以接口形式声明(例:`ConfigBackend`、`SecretBackend`)
- **AND** MUST 由具体前端包在初始化时注入实现

### Requirement: CLI 包提供独立可执行入口

`packages/cli` MUST 暴露 `bin: oja` 命令,可通过 `node packages/cli/dist/index.js` 或全局安装后的 `oja` 直接执行。

#### Scenario: 骨架阶段的最小行为

- **WHEN** 执行 `oja --version`
- **THEN** 输出当前版本号
- **WHEN** 执行 `oja` 或 `oja help`
- **THEN** 输出可用命令列表(骨架阶段允许为空提示)

### Requirement: 统一的构建与测试编排

仓���根 `package.json` MUST 提供 `build`、`test`、`watch` 三个聚合脚本,通过 `pnpm -r` 递归到各包。

#### Scenario: 一键构建

- **WHEN** 在仓库根执行 `pnpm build`
- **THEN** 按依赖顺序编译所有 `packages/*`,任一包失败立即终止

### Requirement: VSCode 扩展打包流水线

仓库 SHALL 在 `packages/vscode` 中提供 `package` 与 `vsce:publish` 脚本,默认基于 `pnpm deploy --filter oj-agent --prod` 落地 `@oj-agent/core` 后再调用 `vsce package` / `vsce publish`,以解决 `workspace:*` 在 vsce 下的解析限制;支持 `OJA_VSCE_MODE=bundle` 切换到 esbuild 单文件模式。

#### Scenario: deploy 模式产出可发布 .vsix
- **WHEN** 在 CI 干净环境中执行 `pnpm --filter oj-agent package`
- **THEN** 生成 `.vsix`,包含完整 `node_modules/@oj-agent/core/`,未出现 `workspace:*` 残留

#### Scenario: bundle 模式精简体积
- **WHEN** 设置 `OJA_VSCE_MODE=bundle` 后执行 package
- **THEN** 通过 esbuild 把 core 打入 `dist/extension.js`,`.vsix` 体积显著小于 deploy 模式

### Requirement: 统一发布脚本

仓库 SHALL 提供 `pnpm release`(对应 `scripts/release.mjs` 等价物),按顺序 build → test → 版本号校验 → npm publish(core/cli) → vsce publish(vscode)。任一步骤失败 MUST 停止并打印回滚指引。`--dry-run` 模式 MUST 调用 `npm publish --dry-run` 与扩展 manifest 校验,不产生写入。

#### Scenario: dry-run 完整通过
- **WHEN** 执行 `pnpm release --dry-run`
- **THEN** 全流程退出码 0,无 npm/vsce 真实写入

#### Scenario: 版本号不一致阻止发布
- **WHEN** core/cli/vscode 三个 `package.json` 版本号不一致
- **THEN** 脚本退出非零,提示需明确各包版本

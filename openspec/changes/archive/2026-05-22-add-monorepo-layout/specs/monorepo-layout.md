# Monorepo Layout Spec

## ADDED Requirements

### Requirement: 仓库采用 pnpm Monorepo 三包结构

仓库根目录下必须包含 `packages/core`、`packages/cli`、`packages/vscode` 三个独立包，通过 `pnpm-workspace.yaml` 管理。

#### Scenario: 包边界

- **WHEN** 开发者新增功能代码
- **THEN** 必须明确归属到三个包之一
- **AND** 跨包引用必须通过 `@oj-agent/core` 显式依赖，禁止使用相对路径穿越包边界

### Requirement: 依赖方向单向收敛于 core

`packages/cli` 与 `packages/vscode` 都可以依赖 `@oj-agent/core`；`@oj-agent/core` 不得反向依赖任何前端包。

#### Scenario: core 包零 VSCode 依赖

- **WHEN** 检查 `packages/core/package.json` 与 `packages/core/src/`
- **THEN** 不得出现 `vscode`、`@types/vscode` 字样
- **AND** 不得出现任何 `vscode.*` API 调用

#### Scenario: 平台无关的抽象

- **WHEN** core 需要访问 IDE / 操作系统能力（如配置存储、密钥存储、文件系统）
- **THEN** 必须以接口形式声明（例：`ConfigBackend`、`SecretBackend`）
- **AND** 由具体前端包在初始化时注入实现

### Requirement: CLI 包提供独立可执行入口

`packages/cli` 必须暴露 `bin: oja` 命令，可通过 `node packages/cli/dist/index.js` 或全局安装后的 `oja` 直接执行。

#### Scenario: 骨架阶段的最小行为

- **WHEN** 执行 `oja --version`
- **THEN** 输出当前版本号
- **WHEN** 执行 `oja` 或 `oja help`
- **THEN** 输出可用命令列表（骨架阶段允许为空提示）

### Requirement: 统一的构建与测试编排

仓库根 `package.json` 必须提供 `build`、`test`、`watch` 三个聚合脚本，通过 `pnpm -r` 递归到各包。

#### Scenario: 一键构建

- **WHEN** 在仓库根执行 `pnpm build`
- **THEN** 按依赖顺序编译所有 `packages/*`，任一包失败立即终止

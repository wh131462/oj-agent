## ADDED Requirements

### Requirement: 统一 release 脚本

仓库 SHALL 提供 `scripts/release.mjs`(或等价的 pnpm workspace script),能够按顺序构建、测试、发布 `@oj-agent/core`、`@oj-agent/cli`(npm) 与 `oj-agent`(VSCode Marketplace)。

#### Scenario: 完整发布流程
- **WHEN** 维护者在干净的工作区执行 `pnpm release`
- **THEN** 脚本依次执行 `pnpm -r build` → `pnpm -r test` → 版本号 bump → `pnpm -r publish --access public` → `pnpm --filter oj-agent vsce:publish`

#### Scenario: 中途失败停止
- **WHEN** 任一步骤非零退出
- **THEN** 脚本立即停止,打印当前步骤与回滚指引(npm 已发版本仅能 deprecate;Marketplace 可下架 .vsix)

### Requirement: VSCode 扩展打包解决 workspace:* 依赖

VSCode 扩展打包 SHALL 默认使用 `pnpm deploy --filter oj-agent --prod` 将 `@oj-agent/core` 落成真实文件后再运行 `vsce package`,使产出 `.vsix` 包含完整运行时依赖。MUST 支持环境变量 `OJA_VSCE_MODE=bundle` 切换到 esbuild 单文件兜底模式。

#### Scenario: 默认 deploy 模式
- **WHEN** 在 CI 中执行 `pnpm --filter oj-agent package`,未设置 `OJA_VSCE_MODE`
- **THEN** 先 `pnpm deploy` 到临时目录,再在该目录 `vsce package`,输出 `.vsix`

#### Scenario: bundle 兜底模式
- **WHEN** 设置 `OJA_VSCE_MODE=bundle` 后执行打包
- **THEN** 使用 esbuild 将 core 打成单文件 `dist/extension.js`,`.vsix` 体积显著缩小

#### Scenario: 产出可被 vsce 接受
- **WHEN** 对产出的 `.vsix` 运行 `vsce show <file>`(或在本地安装)
- **THEN** 无 `workspace:*` 解析错误,扩展可正常激活

### Requirement: 发布前 dry-run 校验

release 脚本 SHALL 在真实发布前提供 `--dry-run` 模式,执行 `npm publish --dry-run` 与 `vsce ls` 等价的校验,避免命名冲突或元数据缺失。

#### Scenario: dry-run 通过
- **WHEN** 执行 `pnpm release --dry-run`
- **THEN** 所有包通过 `npm publish --dry-run`,扩展 manifest 校验通过,无写入操作

### Requirement: 版本号一致性

release 脚本 SHALL 保证 `@oj-agent/core`、`@oj-agent/cli` 与 `oj-agent` 扩展三者版本号在同一次发布中显式声明,任一缺失或冲突 MUST 阻止发布。

#### Scenario: 版本不一致阻止发布
- **WHEN** 三个包的 `package.json` version 字段不一致且未通过 changesets 声明
- **THEN** 脚本退出非零,提示需要明确各包版本

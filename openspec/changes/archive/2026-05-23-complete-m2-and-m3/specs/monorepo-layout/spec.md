## ADDED Requirements

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

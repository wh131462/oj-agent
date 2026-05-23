# Release Guide

OJ-Agent monorepo 同时发布三个产物：

- `@oj-agent/core` → npm（lib）
- `@oj-agent/cli` → npm（带 `oja` bin）
- `oj-agent` → VSCode Marketplace（扩展）

三者**版本号锁步**。

## 一次发布流程

### 1. 准备工作（首次）

```bash
# 登录 npm（@oj-agent scope 需要 access public）
npm login

# 登录 VSCode Marketplace
npx @vscode/vsce login wh131462
# 提示输入 PAT，从 https://dev.azure.com/<org>/_usersSettings/tokens 创建
```

### 2. Bump 版本号

```bash
# 三包同步到 0.2.0
pnpm -r --filter "./packages/*" exec npm version 0.2.0 --no-git-tag-version

# 提交
git add packages/*/package.json
git commit -m "chore: release v0.2.0"
```

或手动改三个 `package.json` 的 `version` 字段（必须一致）。

### 3. Dry-run 演练

```bash
pnpm release:dry-run
```

该步骤会：

1. 校验三包版本一致
2. `pnpm -r build` + `pnpm -r test`
3. `npm publish --dry-run`（核心 + CLI）
4. `vsce package --dry-run`

失败立即停止。**生产发布前必须先过 dry-run��**

### 4. 真发布

```bash
pnpm release
```

顺序：

1. `pnpm publish @oj-agent/core` → npm
2. `pnpm publish @oj-agent/cli` → npm
3. `vsce publish` → VSCode Marketplace

每步失败立即终止。

### 5. 打 Tag

```bash
git tag v0.2.0
git push origin v0.2.0
```

## 回滚策略

### npm 已发布

npm 不允许删除已发布版本。仅能：

```bash
npm deprecate @oj-agent/core@0.2.0 "Critical bug, use 0.2.1+"
```

然后立即发布修复版（0.2.1）。

### VSCode Marketplace

登录 https://marketplace.visualstudio.com/manage 后台，对该版本点 "Unpublish"。Marketplace 允许下架；下架后用户不会再被推送更新，但已安装用户不受影响。

### 中途失败的混合状态

如果 `pnpm release` 在 npm 发布成功、vsce 失败时退出：

- npm 已经发布，不可逆
- 修复 vsce 问题后再次执行 `pnpm release` 时，`pnpm publish` 会因为版本已存在而失败 → 需要 bump 到 0.2.1 重新走全流程

## 打包模式

VSCode 扩展依赖 `workspace:*` 引用 `@oj-agent/core`，`vsce package` 默认无法解析。

### deploy 模式（默认）

```bash
OJA_VSCE_MODE=deploy node scripts/vsce-package.mjs
# 等价于 pnpm --filter oj-agent package
```

用 `pnpm deploy --prod` 把 core 拷贝成真实 `node_modules`，再在该目录跑 `vsce package`。产物体积包含完整运行时依赖。

### bundle 模式（兜底）

```bash
OJA_VSCE_MODE=bundle node scripts/vsce-package.mjs
```

用 esbuild 把 core 打成 `dist/extension.js` 单文件。`vscode / playwright-core / keytar` 保留为 external。

选用建议：默认 deploy；当 marketplace 文件大小敏感或 deploy 模式在 CI 上有兼容问题时切到 bundle。

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) 在每次 push 到 master 时跑 `release:dry-run`，确保发布流水线不会无声坏掉。

## 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| `pnpm publish` 报 `403 Forbidden` | 没���发布权限 / 包名被占用 | 确认登录账号；@oj-agent scope 是否归属当前账号 |
| `vsce package` 报 `workspace: protocol not supported` | 没走 vsce-package.mjs，直接调了 `vsce package` | 用 `pnpm --filter oj-agent package` |
| 版本号校验失败 | 三个 `package.json` 不一致 | `pnpm -r --filter "./packages/*" exec npm version <v> --no-git-tag-version` |
| dry-run 卡在 test 步骤 | 测试失败 | 修复测试再发布。release.mjs 不会跳过 |
| `vsce login` 报 `Personal Access Token verification failed` | PAT 过期或权限不足 | 重建 PAT，需勾选 Marketplace > Manage |

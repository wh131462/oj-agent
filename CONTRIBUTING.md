# Contributing

## Versioning & Release

### Version management decision

**Manual version bumps**（不引入 changesets）。

**Why**: 当前 monorepo 三个包（`@oj-agent/core` / `@oj-agent/cli` / `oj-agent`）锁步发布；维护者人数极少（1-2 人）；改一个包通常意味着另外两个也要发新版。引入 changesets 会增加额外的 PR-time 流程与脚本依赖，收益有限。当包稳定（M3 之后）出现独立更新节奏时再考虑迁移。

### Bump versions

三个 `package.json` 的 `version` 字段必须一致。统一 bump：

```bash
# 三个包同步到 0.2.0
pnpm -r --filter "./packages/*" exec npm version 0.2.0 --no-git-tag-version
```

或手动修改：

- `packages/core/package.json`
- `packages/cli/package.json`
- `packages/vscode/package.json`

### Dry-run

推送前必须先演练：

```bash
pnpm release:dry-run
```

该命令会：

1. 校验三个 `package.json` 版本一致
2. `pnpm -r build` + `pnpm -r test`
3. `pnpm publish --dry-run` 校验 npm 元数据
4. `vsce package --dry-run` 校验扩展元数据

任一步失败立即停止。

### 真发布

确保已登录：

```bash
npm login                # @oj-agent npm scope
npx @vscode/vsce login wh131462   # VSCode Marketplace publisher
```

然后：

```bash
pnpm release
```

顺序：先 npm（core / cli），再 vsce（vscode）。npm 失败立即中止；vsce 失败时 npm 已发布，下次发版同步。

### Rollback

- **npm**: 已发布版本无法删除，仅能 `npm deprecate @oj-agent/<pkg>@<ver> "<reason>"` 后发修复版
- **VSCode Marketplace**: 在 https://marketplace.visualstudio.com/manage 控制台下架对应版本

### vsce 打包模式

VSCode 扩展依赖 `workspace:*` 引用 core，`vsce package` 默认无法解析。`scripts/vsce-package.mjs` 提供两种模式：

- `OJA_VSCE_MODE=deploy`（默认）：用 `pnpm deploy --prod` 把 core 拷贝成真实 `node_modules` 后再打包
- `OJA_VSCE_MODE=bundle`：用 `esbuild` 把 core 打成单文件 bundle，体积更小但失去 sourcemap 文件级粒度

## Run tests

```bash
pnpm -r test
```

## Build

```bash
pnpm -r build
```

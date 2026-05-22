# Tasks

## 1. Monorepo 骨架
- [ ] 1.1 改造根 `package.json` 为 workspaces 私有 root，保留共享 devDeps
- [ ] 1.2 新增 `pnpm-workspace.yaml` 声明 `packages/*`
- [ ] 1.3 新增 `tsconfig.base.json`，抽出共享编译选项

## 2. packages/core
- [ ] 2.1 创建 `packages/core/package.json`（零 VSCode 依赖）与 `tsconfig.json`
- [ ] 2.2 迁移 `src/core/ai/*` → `packages/core/src/ai/`，代码逻辑零修改
- [ ] 2.3 迁移 `src/core/http/*` → `packages/core/src/http/`
- [ ] 2.4 新建 `packages/core/src/platform/adapter.ts`，定义 `PlatformAdapter` / `ProblemSummary` / `ProblemDetail` / `SubmissionId` / `JudgeResult` 等类型契约
- [ ] 2.5 创建 `packages/core/src/index.ts` barrel，统一对外导出

## 3. packages/vscode
- [ ] 3.1 创建 `packages/vscode/package.json`，复用现有 VSCode contributes 配置，依赖 `@oj-agent/core: workspace:*`
- [ ] 3.2 创建 `packages/vscode/tsconfig.json`
- [ ] 3.3 迁移 `src/extension.ts` → `packages/vscode/src/extension.ts`
- [ ] 3.4 迁移 `src/extension/*` → `packages/vscode/src/extension/`
- [ ] 3.5 把所有 `../core/...` import 改为 `@oj-agent/core`

## 4. packages/cli
- [ ] 4.1 创建 `packages/cli/package.json`，`bin: oja`，依赖 `@oj-agent/core: workspace:*`
- [ ] 4.2 创建 `packages/cli/tsconfig.json`
- [ ] 4.3 创建 `packages/cli/src/index.ts` 骨架（仅打印 help/version）

## 5. 测试与 IDE 配置
- [ ] 5.1 按归属把 `test/*.test.ts` 拆分到 `packages/core/test/` 与 `packages/vscode/test/`
- [ ] 5.2 根 `package.json` scripts 改为 `pnpm -r build/test/watch`
- [ ] 5.3 更新 `.vscode/launch.json`、`.vscode/tasks.json` 路径

## 6. 验证
- [ ] 6.1 `pnpm install` 通过
- [ ] 6.2 `pnpm -r build` 三个包全部编译通过
- [ ] 6.3 `pnpm -r test` 测试数量与原来一致且全绿
- [ ] 6.4 `node packages/cli/dist/index.js --version` 输出 `0.1.0`
- [ ] 6.5 VSCode F5 启动，14 条命令可见、AI 面板可用
- [ ] 6.6 `grep -r "from 'vscode'" packages/core/src` 无结果

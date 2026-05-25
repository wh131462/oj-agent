## 1. 树视图节点扩展

- [x] 1.1 在 [packages/vscode/src/extension/views/problem-tree.ts](packages/vscode/src/extension/views/problem-tree.ts) 的 `ProblemTreeNode` union 中新增 `fileGroup` 与 `file` 两种变体；`fileGroup` 需带 `group: 'solution' | 'cases'` 与 `dir: string`，`file` 带 `filePath` 与 `label`
- [x] 1.2 在 `ProblemTreeDataProvider` 构造参数中注入 `resolveWorkspaceRoot` 依赖（通过 `configBackend` 取 `workspace.root`），便于 `getChildren` 调用 `findProblemDir`
- [x] 1.3 修改 `getChildren(problemNode)`：在原 `PROBLEM_ACTIONS` 列表之后调用 `findProblemDir`，存在则追加 `fileGroup{solution}` 与 `fileGroup{cases}` 两个节点
- [x] 1.4 新增 `getChildren(fileGroupNode)` 分支：`solution` 分组读取目录下首个 `Main.java` 或匹配 `^solution\.[a-z]+$` 的文件，转成 `file` 叶子；`cases` 分组读取 `cases/` 下 `^in_(\d+)\.txt$` 与 `^out_(\d+)\.txt$`，按编号升序两两输出
- [x] 1.5 当 `solution` / `cases` 分组无内容时，返回单个 `kind: 'empty'` 占位节点（label `'暂无源文件'` / `'暂无用例'`）
- [x] 1.6 在 `getTreeItem` 中为 `file` 节点设置 `command = { command: 'vscode.open', arguments: [Uri.file(filePath), { viewColumn: ViewColumn.One }] }`，iconPath `$(file)`；为 `fileGroup` 节点设置 `collapsibleState = Collapsed`，iconPath `$(file-code)` / `$(beaker)`

## 2. 命令与右键菜单

- [x] 2.1 在 [packages/vscode/src/extension/commands/platform.ts](packages/vscode/src/extension/commands/platform.ts) 新增 `ojAgent.platform.revealProblemDir` 命令：参数 `ProblemRef`，调用 `findProblemDir` 后通过 `vscode.commands.executeCommand('revealFileInOS', Uri.file(dir))` 打开；不存在则 `showWarningMessage('题目尚未拉取到本地')`
- [x] 2.2 在 [packages/vscode/package.json](packages/vscode/package.json) `contributes.commands` 添加 `ojAgent.platform.revealProblemDir`（title `'在资源管理器中显示'`，category `'OJ-Agent'`）
- [x] 2.3 在 [packages/vscode/package.json](packages/vscode/package.json) `contributes.menus['view/item/context']` 增加条目：`{ command: 'ojAgent.platform.revealProblemDir', when: 'view == ojAgent.problems && viewItem =~ /^problem-/', group: 'navigation@4' }`

## 3. 题面 webview 工具栏

- [x] 3.1 在 webview HTML 模板（[packages/vscode/src/extension/views/problem-webview.ts](packages/vscode/src/extension/views/problem-webview.ts) 或其引用的 webview-content 模板）的工具栏 `打开代码` 按钮后新增 `$(folder-opened)` 按钮，title `'打开目录'`，点击 postMessage `{ type: 'cmd', cmd: 'platform.revealProblemDir' }`
- [x] 3.2 在 [packages/vscode/src/extension.ts](packages/vscode/src/extension.ts) 的 `onCommand` 路由中，对 `platform.revealProblemDir` 命令拼装 `ProblemRef`（webview 当前题目）作为 args，再 `vscode.commands.executeCommand('ojAgent.platform.revealProblemDir', ref)`（**注**：webview onMessage 已用 `m.args ?? ref` 自动传当前 ref，extension.ts 透传 `ojAgent.${cmd}` 即生效，无需额外分支）

## 4. 验证

- [x] 4.1 手动 E2E：在 LeetCode CN 拉取一道题，确认树视图能展开 `解题代码` / `测试用例` 并单击打开对应文件
- [x] 4.2 手动 E2E：未拉取题目展开后不出现两个分组
- [x] 4.3 手动 E2E：题面 webview 工具栏点击 `打开目录` 按钮，系统资源管理器打开正确目录
- [x] 4.4 手动 E2E：右键题目节点选 `在资源管理器中显示`，验证已拉取与未拉取两种分支提示
- [x] 4.5 运行 `pnpm -C packages/vscode lint` 与 `pnpm -C packages/vscode build`（如有 test 脚本也一并运行），确保通过项目 ESLint（**说明**：`packages/vscode` 没有 `lint` 脚本，已执行 `pnpm --filter oj-agent build` 与 `test`，编译无误且 25/25 测试通过）

## 5. 追加增强（实现期间用户追加需求）

- [x] 5.1 树视图 `测试用例` 分组增加 `添加测试用例` inline 按钮与右键菜单（[commands/problems.ts](packages/vscode/src/extension/commands/problems.ts) 注册 `ojAgent.problems.addCaseFromTree` 包装命令，转发到现有 `addCustomCase`）
- [x] 5.2 core: `WorkspaceMeta` 新增 `customCaseIndices?: number[]`；`addCustomCase` 改为只记录到该字段（不再污染 `meta.samples`）；新增 `removeCustomCase(problemDir, index)`，仅允许删除登记编号；`refresh()` 保留 `customCaseIndices`
- [x] 5.3 core: 新增 3 个测试覆盖 add/remove 行为，调整原 `addCustomCase` 断言（meta.samples 不再增长）
- [x] 5.4 vscode: 树视图叶子节点扩展 `caseIndex` / `isCustomCase`；自定义用例 label 加 `· 自定义` 后缀，图标 `$(edit)`，contextValue `problem-file-custom`；通过新 helper `readCustomCaseIndices` 读 meta.json
- [x] 5.5 vscode: 新增 `ojAgent.problems.removeCaseFromTree` 命令（含模态确认）；在 [package.json](packages/vscode/package.json) 注册命令与 inline/右键菜单，菜单 `when` 限定 `viewItem == problem-file-custom`
- [x] 5.6 vscode: [extension.ts](packages/vscode/src/extension.ts) 新增 FileSystemWatcher（glob `<root>/*/*/{solution.*,Main.java,meta.json,cases/*.txt}`，200ms debounce）→ `problemTree.refreshLocalFiles()`；`workspace.root` 配置变更时 watcher 重建
- [x] 5.7 vscode: `ProblemTreeDataProvider` 新增 `refreshLocalFiles()`（只 fire 重渲染，不清平台列表 cache，避免触发远端 listProblems）；`onLanguageChange` 后显式调用以加速响应

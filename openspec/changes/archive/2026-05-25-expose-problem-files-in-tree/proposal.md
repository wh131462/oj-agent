## Why

当前题目相关的本地文件（解题源码、`cases/in_<n>.txt`、`cases/out_<n>.txt`）虽然按约定目录已经落盘，但用户在 VSCode 内无法直接看到与点开：解题源码只能通过题面 webview 内的"打开代码"按钮触发，测试数据文件**完全没有 UI 入口**。在题面 webview 中查阅样例输入输出又受限于排版，调试时来回切换很不顺手。需要把这些本地产物直接暴露在题库树视图（以及相关入口）里，做到一键打开。

## What Changes

- 在 `ojAgent.problems` 题库树的每个**已拉取本地**的题目节点下新增子节点：
  - `解题代码`（叶子节点，单击打开 `solution.*` / `Main.java`）
  - `测试用例`（可展开分组节点，下含每个 `in_<n>.txt` / `out_<n>.txt` 的叶子节点；单击打开对应文件）
- 当题目尚未拉取到本地（找不到 `problemDir`）时，不展示这两个子节点（保持现有 ProblemAction 列表）。
- 新增命令 `ojAgent.platform.openTestCaseFile`：参数为 `{ ref, kind: 'in' | 'out', index }`，按约定路径打开文件；不存在时给出提示。
- 题面 webview 工具栏增加"在资源管理器中显示题目目录"按钮（调用 `revealFileInOS` / `revealInExplorer`），方便直接进入目录查看全部文件。
- 树视图节点 `kind` 类型扩展：新增 `'file'` 与 `'caseGroup'` 两种子节点形态。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `vscode-problem-tree`: 题库树节点结构新增 `解题代码` / `测试用例` 子节点与文件级叶子节点；新增对应命令绑定。
- `vscode-problem-webview`: 题面 webview 工具栏新增"在资源管理器中显示题目目录"操作。

## Impact

- 代码影响范围：
  - [packages/vscode/src/extension/views/problem-tree.ts](packages/vscode/src/extension/views/problem-tree.ts)：节点类型、`getChildren`、`getTreeItem` 扩展
  - [packages/vscode/src/extension/commands/platform.ts](packages/vscode/src/extension/commands/platform.ts)：新增 `openTestCaseFile`、`revealProblemDir` 命令
  - [packages/vscode/src/extension/views/problem-webview.ts](packages/vscode/src/extension/views/problem-webview.ts)：工具栏按钮
  - [packages/vscode/package.json](packages/vscode/package.json)：命令贡献声明
- 不引入新依赖，不改动 `@oj-agent/core` 的工作区约定。
- 风险：树视图刷新需要 IO（读取 `cases/` 目录），需做缓存/惰性加载，避免每次展开都阻塞。

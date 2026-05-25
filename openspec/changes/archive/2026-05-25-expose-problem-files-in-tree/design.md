## Context

OJ-Agent VSCode 扩展会按约定把每道题拉到本地：

```
<root>/<platform>/<id>-<slug>-<YYYY-MM-DD>/
├── solution.cpp | solution.py | Main.java | solution.js
├── problem.md            (题面)
└── cases/
    ├── in_1.txt
    ├── out_1.txt
    ├── in_2.txt
    ├── out_2.txt
    └── ...
```

入口现状：
- 解题源码：只能从题面 webview 顶部的"打开代码"按钮触发；树视图的 `openCode` action 行为相同。
- 测试用例文件：**没有任何 UI 入口**，AI explainError 间接读取 [packages/vscode/src/extension/context-providers/test-case.ts](packages/vscode/src/extension/context-providers/test-case.ts:37)，但用户无法直接查看。
- 题目目录本身没有"在系统资源管理器中打开"入口。

调试解题时用户必须手工 `cd` 到工作区目录翻文件，这与树视图已经按 `platform → 题目` 组织的层级不一致。

约束：
- 不修改 [packages/core/src/workspace/workspace-manager.ts](packages/core/src/workspace/workspace-manager.ts) 中的目录约定。
- 树视图加载已是惰性（按 `getChildren` 调用），新增子节点必须保持同样的惰性原则，避免列表渲染时同步遍历 `cases/`。
- 不影响 AI explainError、judge runner 等现有读取路径。

## Goals / Non-Goals

**Goals:**
- 在题库树视图为已拉取本地的题目展示 `解题代码` 与 `测试用例` 两个子分组，并可直接点击叶子打开对应文件。
- 题面 webview 工具栏提供"打开题目目录"入口（系统资源管理器）。
- 文件不存在时给出明确提示，不在 UI 中悬挂死链。

**Non-Goals:**
- 不实现树内"编辑/重命名/删除测试用例"等编辑操作（已有 `ojAgent.workspace.addCustomCase` 命令负责新增）。
- 不改变 `cases/` 目录命名规则。
- 不引入文件监听（FileSystemWatcher）做自动刷新；保留手动刷新平台节点的现有方式。
- 不在树视图展示题面 `problem.md` 节点（题面已有专门的 webview 入口）。

## Decisions

### D1：节点结构扩展

`ProblemTreeNode` union 新增两个变体：

```ts
| { kind: 'fileGroup'; platform: PlatformId; summary: PlatformProblemSummary; group: 'solution' | 'cases'; dir: string }
| { kind: 'file'; platform: PlatformId; summary: PlatformProblemSummary; filePath: string; label: string }
```

- `fileGroup` 作为 `problem` 节点的子节点，`collapsibleState = Collapsed`。
- `file` 是叶子节点，`command` 直接绑定到内置 `vscode.open` 命令，传递 `Uri.file(filePath)`。

**为什么不复用现有 `action`？** `action` 是固定枚举（pull / openProblem / openCode / runTest / submit），用于命令触发；文件节点数量动态且需要单击打开，二者关注点不同，分开变体更清晰。

### D2：何时展示文件子节点

在 `getChildren(problemNode)` 阶段：
1. 通过 `findProblemDir(root, ref)` 检查目录是否存在。
2. 若不存在 → 仅返回原来的 `PROBLEM_ACTIONS` 列表（保持现状）。
3. 若存在 → 在 `action` 列表之后追加 `fileGroup{solution}` 与 `fileGroup{cases}` 两个分组节点。

`findProblemDir` 已有 mtime 排序逻辑，复用即可，不引入新的解析。

**备选**：每次都展示分组，点击时再判断。**否决理由**：会出现"展开后空内容/打开失败"的负反馈，体验差。

### D3：`fileGroup{cases}` 的内容生成

惰性进入 `getChildren(caseGroupNode)` 时执行：
1. `fs.readdir(<dir>/cases)`，过滤 `^in_(\d+)\.txt$` 与 `^out_(\d+)\.txt$`。
2. 按编号升序两两配对；每个编号产出两个叶子节点：`#n 输入 (in_n.txt)`、`#n 输出 (out_n.txt)`。
3. 若 `cases/` 不存在或为空 → 返回单个占位节点 `kind: 'empty'`（reason: `'no-data'`）。

**为什么不预先扫一遍缓存？** VSCode TreeView 只在展开时调用 `getChildren`，IO 成本可接受；引入缓存反而要处理失效。

### D4：`fileGroup{solution}` 的内容生成

题目目录下源文件最多一份（约定见 [extension.ts:213](packages/vscode/src/extension.ts#L213)），所以该分组返回 0~1 个 `file` 叶子：
- 优先取 `Main.java`，否则取 `^solution\.[a-z]+$/i` 匹配项的第一个。
- 若没有源文件 → 占位节点 `'no-data'`，提示用户先在 webview 切换语言/创建源文件。

### D5：文件打开方式

`file` 节点的 `TreeItem.command` 直接绑定：

```ts
{ command: 'vscode.open', title: '打开', arguments: [Uri.file(filePath), { viewColumn: ViewColumn.One }] }
```

不走自定义命令，避免引入额外的指令注册成本。**但** "在资源管理器中显示题目目录"功能需要新增命令 `ojAgent.platform.revealProblemDir`，调用 `vscode.commands.executeCommand('revealFileInOS', Uri.file(dir))`。

### D6：题面 webview 工具栏新增按钮

在 `problem-webview.ts` 的 `webview-content` 模板里加按钮 `打开目录`，postMessage 一个新的 command `platform.revealProblemDir`。`extension.ts` 的 `onCommand` 路由按现有方式分发 `ojAgent.platform.revealProblemDir`。

### D7：树视图刷新策略

新增子节点不影响刷新模型；用户拉取题目（`platform.pullProblem` 后调用 `refreshPlatform`）已会清缓存重渲染整棵子树。运行测试后若新增了用例文件，用户需要手动右键平台刷新——本次不引入 watcher（见 Non-Goals）。

## Risks / Trade-offs

- **[树展开 IO 阻塞]** → 仅在展开 `fileGroup{cases}` 时同步读目录，单题用例通常 < 20 个，影响可忽略；若将来用户自定义用例膨胀，再考虑异步占位。
- **[用例文件被外部修改后树未刷新]** → 用户需要手动刷新；权衡：避免 watcher 带来的内存/事件成本。文档中明确该限制。
- **[Windows 上 `revealFileInOS` 行为差异]** → VSCode 内置命令在三平台均可用，但 Linux 下取决于桌面环境；只展示提示信息，不做特殊兼容。
- **[`solution.*` 与 `cases/` 同名冲突]** → 不存在，目录约定隔离。

## ADDED Requirements

### Requirement: 题目节点暴露本地文件

当题目已在本地存在 problemDir（即 [packages/vscode/src/extension/utils/workspace-resolver.ts](packages/vscode/src/extension/utils/workspace-resolver.ts) 中 `findProblemDir` 返回非空）时，第二层题目节点 SHALL 在其原有 `ProblemAction` 子节点列表之后，追加以下分组子节点：

- `解题代码` 分组节点（`fileGroup`，`collapsibleState = Collapsed`），iconPath `$(file-code)`。展开后内部 MUST 仅包含 0~1 个 `file` 叶子节点：优先 `Main.java`，否则匹配 `^solution\.[a-z]+$` 的首个文件。
- `测试用例` 分组节点（`fileGroup`，`collapsibleState = Collapsed`），iconPath `$(beaker)`。展开后内部 MUST 按编号升序列出 `cases/in_<n>.txt` 与 `cases/out_<n>.txt` 配对，每个文件一个 `file` 叶子节点，label 形如 `#<n> 输入` / `#<n> 输出`，description 为相对文件名 `in_<n>.txt` / `out_<n>.txt`。

当 problemDir 不存在时，MUST 不展示这两个分组节点，保持现有 `ProblemAction` 列表不变。

#### Scenario: 已拉取题目展开
- **WHEN** 题目 `leetcode-cn / 1` 已拉取，本地存在 `solution.cpp` 与 `cases/in_1.txt`、`cases/out_1.txt`、`cases/in_2.txt`、`cases/out_2.txt`
- **THEN** 展开该题节点，最后两个子节点为 `解题代码`、`测试用例`；继续展开 `解题代码` 显示 1 个叶子 `solution.cpp`；展开 `测试用例` 依次显示 `#1 输入`、`#1 输出`、`#2 输入`、`#2 输出`

#### Scenario: 未拉取题目
- **WHEN** 题目 `hdoj / 1000` 尚未拉取到本地
- **THEN** 展开该题节点只显示原有 5 个 `ProblemAction` 子节点，不出现 `解题代码` / `测试用例` 分组

#### Scenario: 测试用例目录为空
- **WHEN** 题目已拉取但 `cases/` 目录不存在或为空
- **THEN** 展开 `测试用例` 分组显示一个占位节点 label `'暂无用例'`，无可点击文件

### Requirement: 文件叶子节点单击打开

`file` 类型叶子节点 SHALL 在 `TreeItem.command` 上绑定 VSCode 内置命令 `vscode.open`，arguments 为 `[Uri.file(filePath), { viewColumn: ViewColumn.One }]`。该节点 MUST 不参与右键菜单注册（无 contextValue 子菜单）。

#### Scenario: 单击源码文件
- **WHEN** 用户单击 `解题代码` 下的 `solution.cpp` 叶子
- **THEN** VSCode 在 ViewColumn.One 打开该文件供编辑

#### Scenario: 单击输入文件
- **WHEN** 用户单击 `测试用例` 下的 `#1 输入` 叶子
- **THEN** VSCode 打开 `<problemDir>/cases/in_1.txt`

### Requirement: 题目目录右键菜单新增"在资源管理器中显示"

第二层题目节点的右键菜单 SHALL 新增一项 `ojAgent.platform.revealProblemDir` 标签 `'在资源管理器中显示'`，`when: viewItem == problem-<platform>`。该命令 MUST 调用 VSCode 内置 `revealFileInOS` 打开题目目录；目录不存在时 MUST 弹出 Notification `'题目尚未拉取到本地'`。

#### Scenario: 显示已拉取题目目录
- **WHEN** 用户右键 LeetCode `1. 两数之和`(已拉取)选择 `在资源管理器中显示`
- **THEN** 操作系统资源管理器打开 `<root>/leetcode-cn/1-two-sum-<date>/`

#### Scenario: 未拉取时提示
- **WHEN** 用户右键尚未拉取的题目选择 `在资源管理器中显示`
- **THEN** 出现 Notification `'题目尚未拉取到本地'`，不打开任何窗口

### Requirement: 自定义用例标识与增删入口

`测试用例` 分组下的 `file` 叶子节点 SHALL 根据 `meta.customCaseIndices` 区分:

- 自定义用例:label 后缀 ` · 自定义`,iconPath `$(edit)`,contextValue `problem-file-custom`
- 远端 sample:label 不带后缀,iconPath `$(file)`,contextValue `problem-file`

`测试用例` 分组节点(`viewItem == problem-fileGroup-cases`) MUST 在 inline 与右键菜单注册 `ojAgent.problems.addCaseFromTree` 命令(标签 `'添加测试用例'`,icon `$(add)`)。该命令 SHALL 包装现有 `ojAgent.platform.addCustomCase`,从节点解出 `ProblemRef` 传入,完成后刷新树。

自定义用例叶子节点(`viewItem == problem-file-custom`) MUST 在 inline 与右键菜单注册 `ojAgent.problems.removeCaseFromTree` 命令(标签 `'删除自定义用例'`,icon `$(trash)`)。远端 sample 叶子(`problem-file`) MUST NOT 出现删除项。删除前 MUST 弹模态确认对话框 `'确定删除自定义用例 #<n>?'`;确认后调用 `workspaceManager.removeCustomCase(dir, index)`,若返回 `true` 显示 Information `'已删除用例 #<n>'`,否则显示 Warning `'删除失败：该编号未登记为自定义用例'`。

#### Scenario: 自定义用例展示
- **WHEN** `meta.customCaseIndices = [3]`,展开 `测试用例` 分组
- **THEN** `#1 输入` 与 `#2 输入` 显示为普通 `file` 图标;`#3 输入 · 自定义` 与 `#3 输出 · 自定义` 显示为 `$(edit)` 图标

#### Scenario: 添加用例入口
- **WHEN** 用户点击 `测试用例` 分组行尾的 `+` inline 按钮
- **THEN** 触发输入框收集 input/expected output → `addCustomCase` 写盘 → 树自动刷新出现 `#<N+1>` 自定义条目

#### Scenario: 删除自定义用例
- **WHEN** 用户右键 `#3 输入 · 自定义` 选择 `删除自定义用例`,在模态确认对话框点击 `'删除'`
- **THEN** `cases/in_3.txt` 与 `cases/out_3.txt` 被删除,`meta.customCaseIndices` 移除编号 3,树自动刷新

#### Scenario: 远端 sample 不出现删除菜单
- **WHEN** 用户右键 `#1 输入`(远端 sample)
- **THEN** 菜单中不出现 `删除自定义用例` 项

### Requirement: 本地文件变动实时同步

扩展激活时 MUST 注册一个 `FileSystemWatcher`,glob 为 `<workspace.root>/*/*/{solution.*,Main.java,meta.json,cases/*.txt}`,监听 `onDidCreate` / `onDidDelete` / `onDidChange` 三类事件。所有事件 MUST 经过 200ms debounce 合并,触发一次 `ProblemTreeDataProvider.refreshLocalFiles()`(只重渲染节点子树,不清空平台列表 cache,避免触发远端 `listProblems`)。

当 `workspace.root` 配置变更时,旧 watcher MUST dispose,按新 root 重新安装。扩展卸载时 watcher MUST 一同释放。

#### Scenario: pull 后自动刷新
- **WHEN** 用户右键 `拉取到本地`,`writeProblem` 写出 `solution.cpp`/`meta.json`/`cases/in_1..2.txt`
- **THEN** 在 ~200ms 内,该题节点展开自动出现 `解题代码` / `测试用例` 分组,无需手动点击 `$(refresh)` 按钮

#### Scenario: 外部文件修改触发刷新
- **WHEN** 用户在系统资源管理器中删除 `cases/in_3.txt`(自定义用例)
- **THEN** 在 ~200ms 内树视图 `#3` 条目消失;`refreshLocalFiles` 不会触发任何 `listProblems` 网络请求

#### Scenario: workspace.root 切换重建 watcher
- **WHEN** 用户执行 `ojAgent.workspace.setRoot` 选择新根目录
- **THEN** 旧 watcher disposed,新 watcher 监听新 root;切换前的旧目录文件变化不再触发刷新

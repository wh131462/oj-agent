## ADDED Requirements

### Requirement: 工作区根目录

系统 SHALL 提供配置 `ojAgent.workspace.root`，默认 `~/oj-agent-workspace`。所有题目目录 MUST 创建在该根目录下，且 MUST 在首次写入前检查并自动创建。

#### Scenario: 默认根目录创建

- **WHEN** 首次拉取题目且根目录不存在
- **THEN** 系统 SHALL 创建 `~/oj-agent-workspace/`，并在通知栏显示「工作区已创建于 ...，可在设置中更改」

### Requirement: 题目目录命名

题目目录 MUST 命名为 `<platform>/<id>-<slug>-<YYYY-MM-DD>/`，`slug` 中的非 URL 安全字符 MUST 替换为 `-`，连续 `-` MUST 合并。日期 MUST 取**首次拉取**的本地日期，重新拉取不更新日期段。

#### Scenario: 中文标题转 slug

- **WHEN** 拉取 LeetCode CN 题目 id=`1`, title=`两数之和`，于 2026-05-21 操作
- **THEN** 目录名 SHALL 为 `leetcode-cn/1-liang-shu-zhi-he-2026-05-21/`（或保留中文 slug 视实现，但 MUST 在跨平台均合法）

### Requirement: 题目文件结构

每个题目目录 MUST 至少包含：
- `problem.md`：题面 Markdown（含 KaTeX）。
- `meta.json`：`{ platform, id, slug, title, difficulty, tags, limits, samples:[{in,out}], codeSnippets, fetchedAt, updatedAt, etag? }`。
- `cases/in_<n>.txt`、`cases/out_<n>.txt`：每个样例的输入与期望输出，`<n>` 从 1 起。
- `solution.<ext>`：当用户首次选择语言后由系统按 `codeSnippets` 写入；若已存在 MUST 不覆盖。

#### Scenario: 用户已有代码不被覆盖

- **WHEN** 用户已在 `solution.py` 写了代码后再次「拉取最新题面」
- **THEN** `problem.md` / `meta.json` / `cases/*` 按需更新，`solution.py` 内容 SHALL 保持不变

### Requirement: 离线缓存

系统 SHALL 优先从工作区读取已拉取题目（题面、样例、元数据）以支持断网查看。仅当用户显式触发「刷新」或远程返回 `updatedAt` 比本地新时，才覆盖 `problem.md`/`meta.json`/`cases/*`。

#### Scenario: 断网打开已拉取题目

- **WHEN** 网络断开，用户从历史列表点击已拉取题目
- **THEN** 题面 Webview SHALL 渲染本地 `problem.md`，工具栏「刷新」按钮显示，但不主动联网

### Requirement: 代码模板生成

系统 SHALL 根据用户选择的语言从 `meta.json.codeSnippets[lang]` 写入 `solution.<ext>`。若平台未提供该语言模板，MUST 写入空文件并在文件顶部插入一行注释 `// codeSnippet not provided by platform`（按语言注释语法）。

#### Scenario: LeetCode 提供 python3 模板

- **WHEN** 拉取「两数之和」并选择 python，`codeSnippets['python3']` 存在
- **THEN** `solution.py` 内容 SHALL 等于该模板字符串

### Requirement: 自定义测试用例

用户 SHALL 可通过命令「添加自定义用例」在 `cases/` 目录追加 `in_<next>.txt` 与 `out_<next>.txt`，并 MUST 同步追加到 `meta.json.samples`，标记 `{ source:'user' }`。

#### Scenario: 添加用户样例

- **WHEN** 用户输入 input=`1 2\n`, expected=`3\n` 并保存
- **THEN** 目录新增 `cases/in_3.txt`、`cases/out_3.txt`，`meta.json.samples[2] = { in:'1 2\n', out:'3\n', source:'user' }`

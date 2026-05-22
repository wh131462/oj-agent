## ADDED Requirements

### Requirement: 工具链探测

系统 SHALL 在用户首次使用某语言或主动触发「检测工具链」时执行 `which`/`where` 探测 `g++`、`python3`、`javac` & `java`、`node`。探测结果 MUST 缓存到 `globalState.toolchain`，并在 Output Channel 打印探测日志。

#### Scenario: 缺少 g++

- **WHEN** 用户选择 C++ 但本机无 `g++`
- **THEN** 系统弹出错误：「未检测到 g++，请安装后重试」，并跳转到对应文档链接；不执行编译

### Requirement: 编译命令模板

系统 SHALL 提供可配置项：`ojAgent.lang.cpp.compile`（默认 `g++ -O2 -std=c++17 -o {out} {src}`）、`ojAgent.lang.cpp.run`（默认 `{out}`）、`ojAgent.lang.python.run`（默认 `python3 {src}`）、`ojAgent.lang.java.compile`（默认 `javac {src}`）、`ojAgent.lang.java.run`（默认 `java -cp {dir} {main}`）、`ojAgent.lang.javascript.run`（默认 `node {src}`）。占位符 MUST 仅在 `{out} {src} {dir} {main}` 范围内。

#### Scenario: 用户自定义编译参数

- **WHEN** 用户将 `ojAgent.lang.cpp.compile` 改为 `g++ -O0 -g -std=c++17 -o {out} {src}`
- **THEN** 后续 C++ 测试 SHALL 使用该命令

### Requirement: 编译产物缓存

系统 SHALL 以 `sha256(src + compileCmd)` 为 key 缓存可执行产物到 `<problemDir>/.build/`。命中缓存 MUST 跳过编译。源码修改导致 key 变化 MUST 重新编译。

#### Scenario: 重复运行命中缓存

- **WHEN** 用户连续两次「运行全部样例」期间未修改 `solution.cpp`
- **THEN** 第二次 SHALL 跳过编译，直接执行已有产物

### Requirement: 用例执行

系统 SHALL 按用例顺序执行：
- 启动子进程 `child_process.spawn`，stdin 写入 `in_<n>.txt`，stdout/stderr 全部捕获。
- 单用例超时默认 3000ms，可由 `ojAgent.judge.timeoutMs` 配置或题目 `limits.timeMs * 2` 覆盖。
- 超时 MUST 强制 kill 子进程并标记 `TLE`。

#### Scenario: 超时被 kill

- **WHEN** 子进程运行 4 秒未结束、配置超时 3 秒
- **THEN** 系统在 3 秒整 SHALL 调用 `process.kill('SIGKILL')`，结果面板该用例标记为 `TLE 3.0s`

### Requirement: 输出归一化与 diff

系统 SHALL 在比对前对 expected / actual 同时应用归一化：
- 每行右侧空白字符（`\s+$`）去除。
- 文末尾随空行去除。
- 行间空行保留。

归一化后逐字节比对，命中差异时 MUST 记录第一处差异的行号与列号，用于 UI 高亮。

#### Scenario: 末尾换行不算差异

- **WHEN** expected=`3\n`、actual=`3`（无换行）
- **THEN** 归一化后两者一致，标记 `AC`

#### Scenario: 行尾空格不算差异

- **WHEN** expected=`hello\n`、actual=`hello   \n`
- **THEN** 标记 `AC`

### Requirement: 结果面板

系统 SHALL 提供 `OJ-Agent: 测试结果` Webview 面板，每个用例 MUST 展示：编号、verdict（AC/WA/TLE/RE/CE）、耗时、内存（若可得）、可折叠 input / expected / actual / diff（unified diff，高亮差异行）。失败用例 MUST 提供「解释错因」按钮（调用 `ojAgent.ai.explainError` 命令并附带上下文）。

#### Scenario: 失败用例显示 diff

- **WHEN** case #2 状态为 WA
- **THEN** 面板展开 case #2 SHALL 显示 expected / actual 双栏 diff，差异行红色高亮，并显示「解释错因」按钮

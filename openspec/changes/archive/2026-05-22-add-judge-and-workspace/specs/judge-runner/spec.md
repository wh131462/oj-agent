## ADDED Requirements

### Requirement: JudgeRunner 接口

`@oj-agent/core` SHALL 提供 `JudgeRunner.runAll(options)` 方法,接受 `{ problemDir, lang, sourcePath?, cases?, timeoutMs?, compileCmdTemplate?, runCmdTemplate? }`,返回 `{ cases: JudgeCaseResult[], compileError?: string }`。`cases` 为空时 MUST 默认加载 `meta.json.samples` 的全部用例。

#### Scenario: 默认加载样例
- **WHEN** 调用 `runAll({ problemDir, lang: 'cpp' })` 不传 `cases`
- **THEN** 读取 `meta.json.samples` 与 `cases/in_*.txt` 顺序对齐,所有 case 都被执行

### Requirement: 工具链探测

`JudgeRunner` SHALL 在 run 前通过 `ToolchainProbe.probe()` 检查所需工具(`cpp` → `g++`,`python3` → `python3`,`java` → `javac + java`,`javascript` → `node`)。缺失工具 MUST 抛 `AdapterError('PLATFORM_ERROR', message)`,`message` 包含工具名与官方安装链接。

#### Scenario: 缺少 g++
- **WHEN** PATH 中无 `g++` 与 `clang++`,调 `runAll({ lang: 'cpp' })`
- **THEN** 抛 `AdapterError('PLATFORM_ERROR')`,message 含 `'g++'` 与安装指引

### Requirement: 编译模板

`JudgeRunner` SHALL 按下表使用默认编译/运行模板,占位符 `{src}` `{out}` `{dir}` `{main}` 在执行前替换:

| lang | compileCmd | runCmd |
|---|---|---|
| cpp | `g++ -O2 -std=c++17 -o {out} {src}` | `{out}` |
| python3 | (无) | `python3 {src}` |
| java | `javac -d {dir} {src}` | `java -cp {dir} {main}` |
| javascript | (无) | `node {src}` |

选项可覆盖默认模板。`{main}` 仅 Java 使用,值为类名 `Main`(`solution.java` 文件名固定)。

#### Scenario: 占位符替换
- **WHEN** cpp,`src=/tmp/sol.cpp`,`out=/tmp/.build/<hash>/sol`
- **THEN** 实际执行 `g++ -O2 -std=c++17 -o /tmp/.build/<hash>/sol /tmp/sol.cpp`

#### Scenario: 自定义模板
- **WHEN** `compileCmdTemplate: 'clang++ -O0 -g -o {out} {src}'`
- **THEN** 使用该模板,不再回退默认

### Requirement: 用例执行

对每个 case,`JudgeRunner` SHALL `spawn` 编译产物子进程,通过 `child.stdin.write(input)` 一次性写入并立即 `end()`,捕获 stdout 与 stderr。`timeoutMs`(默认 3000)wallclock 到期后 MUST 用 `SIGKILL` 终止子进程,verdict 标记 `'TLE'`,`timeMs` 等于实际 wall 时间。

#### Scenario: 正常 AC
- **WHEN** 子进程输出与 expected 完全相同
- **THEN** `case.verdict === 'AC'`,`stdout` 包含原始输出(未去末尾换行)

#### Scenario: 子进程超时
- **WHEN** 子进程 sleep 10s,`timeoutMs: 3000`
- **THEN** 3s 后子进程被 SIGKILL,`case.verdict === 'TLE'`,`timeMs ≈ 3000 ± 200`

#### Scenario: 子进程非零退出
- **WHEN** 子进程 exit code 非 0 但有 stdout
- **THEN** `case.verdict === 'RE'`,`stderr` 保留

### Requirement: 输出归一化与 diff

`JudgeRunner` SHALL 在比较 `stdout` 与 `expected` 前对两边各自做归一化:
1. 按 `\n` 切分
2. 每行右侧的空格、Tab、`\r` 字符去除(`rstrip`)
3. 删除末尾所有空行
4. 重新用 `\n` 连接

归一化后若完全相等 verdict = `'AC'`,否则 `'WA'`。`WA` 时 MUST 计算 `diff`:
- `firstDiffLine`:首处不同的行号(1-based)
- `firstDiffCol`:该行首处不同字符的列(0-based,字符为单位,不是字节)
- `unifiedDiff`:基于 `diff` npm 包或手写 LCS 的 unified diff;超过 100 行 MUST 截断并加 `... <K> more lines elided`

#### Scenario: 行尾空格不影响
- **WHEN** stdout `'1 \n2  \n'`,expected `'1\n2\n'`
- **THEN** verdict = AC

#### Scenario: 末尾换行不影响
- **WHEN** stdout `'1\n2'`,expected `'1\n2\n\n'`
- **THEN** verdict = AC

#### Scenario: 首处差异定位
- **WHEN** stdout `'abc\ndef\n'`,expected `'abc\ndeg\n'`
- **THEN** verdict = WA,`firstDiffLine === 2`,`firstDiffCol === 2`(对应 `'f'` vs `'g'`)

### Requirement: 编译产物缓存

`JudgeRunner` SHALL 在编译前计算 `sha256(srcContent + compileCmd 渲染后字符串)`,产物落到 `<problemDir>/.build/<hash>/`。若该目录存在 MUST 跳过编译直接 run。`solution.<ext>` 变更后哈希自然变更,新建子目录;旧目录不主动清理。

#### Scenario: 二次运行命中缓存
- **WHEN** 同一份代码连续 `runAll` 两次
- **THEN** 第二次不再调用 g++(`spawn` 计数器仅 1)

#### Scenario: 代码变更后重新编译
- **WHEN** 修改 `solution.cpp` 一个字符后再 `runAll`
- **THEN** 新建另一个 `.build/<hash>/` 目录,重新编译

### Requirement: 编译错误处理

`JudgeRunner` SHALL 在编译子进程退出码非零时返回 `{ cases: [], compileError: '<stderr 全文>' }`,MUST NOT 抛异常,MUST NOT 执行任何用例。

#### Scenario: C++ 编译错误
- **WHEN** `solution.cpp` 缺分号,`runAll({ lang: 'cpp' })`
- **THEN** 返回 `cases === []`,`compileError` 非空且包含 g++ stderr

### Requirement: Toolchain 探测器

`ToolchainProbe.probe()` SHALL 在 PATH 中查找 `g++ / clang++ / python3 / python / javac / java / node`,把命中工具的绝对路径与 `--version` 首行写入返回对象。MUST 失败容忍(找不到只返回 `null`,不抛错)。结果在进程内缓存 5 分钟。

#### Scenario: 部分缺失
- **WHEN** 系统有 `python3`、`node`,无 `g++` 与 `javac`
- **THEN** 返回 `{ python3: { path, version }, node: { path, version }, gpp: null, javac: null, ... }`,不抛错

#### Scenario: 缓存命中
- **WHEN** 5 分钟内连续调用 `probe()` 两次
- **THEN** 第二次直接返回缓存值,不再 `spawn` 任何 `--version`

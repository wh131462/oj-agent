# problem-workspace Specification

## Purpose

定义 `@oj-agent/core` 中 `WorkspaceManager` 的行为规范,负责把远端题目详情落盘为标准化的题目工作目录(题面、meta、样例、用户代码模板),支持刷新、自定义样例追加与离线读取。

## Requirements

### Requirement: 工作区目录命名

`WorkspaceManager.resolveProblemDir(platform, id, slug)` SHALL 返回路径 `<rootDir>/<platform>/<id>-<slug>-<YYYY-MM-DD>/`,其中:
- `platform` 为 `PlatformId` 直接拼接(`leetcode-cn` 不再做转换)
- `id` 原样拼接
- `slug` 经规范化:小写、ASCII 字母数字与 `-`、最多 60 字符;非 ASCII 字符 MUST 整体替换为 `'p' + id + '-' + sha1(originalSlug).slice(0,8)`
- 日期取 `new Date().toISOString().slice(0,10)`(UTC)

#### Scenario: 正常 slug
- **WHEN** `resolveProblemDir('leetcode-cn', '1', 'two-sum')` 在 2026-05-21
- **THEN** 返回 `<root>/leetcode-cn/1-two-sum-2026-05-21/`

#### Scenario: 中文 slug 回退
- **WHEN** `resolveProblemDir('hdoj', '1000', '简单加法')`
- **THEN** 返回 `<root>/hdoj/1000-p1000-<8 位 sha1>-2026-05-21/`(不含中文)

### Requirement: 题面与样例落盘

`writeProblem(detail, options)` SHALL 在解析出的 problemDir 下创建以下文件:

- `problem.md`:Markdown 题面(取自 `detail.statement`)
- `meta.json`:JSON,字段 `{ platform, id, title, slug, url, difficulty, tags, samples, timeLimitMs?, memoryLimitKb?, codeSnippets?, fetchedAt, updatedAt, statementHash, customCaseIndices? }`
- `cases/in_1.txt` ~ `cases/in_<N>.txt`:对应 `detail.samples[].input`
- `cases/out_1.txt` ~ `cases/out_<N>.txt`:对应 `detail.samples[].output`(可空,空时仍创建 0 字节文件)
- `solution.<ext>`:按 `options.defaultLang` 选择扩展名;Java 文件名固定 `Main.java`

`meta.json.samples` MUST 始终只反映远端题面 sample;本地新增的自定义用例 MUST 通过 `meta.customCaseIndices: number[]` 单独登记,不写入 `samples`,以避免污染 AI 上下文与题面展示。`customCaseIndices` 为可选字段,旧 meta 缺省视为空数组。

文件 MUST 使用 LF 换行符,UTF-8 无 BOM。

#### Scenario: 首次拉取
- **WHEN** `writeProblem(twoSumDetail, { rootDir: '/tmp/ws', defaultLang: 'cpp' })`
- **THEN** 创建 `1-two-sum-<date>/` 目录,内含 `problem.md / meta.json / cases/in_1.txt / cases/out_1.txt / solution.cpp`,返回 `{ created: true }`;`meta.customCaseIndices` 字段不存在或为空数组

#### Scenario: solution 已存在不覆盖
- **WHEN** problemDir 已存在 `solution.cpp` 含用户代码,再次调 `writeProblem(samedetail, { defaultLang: 'cpp' })`
- **THEN** `solution.cpp` 内容不变;返回 `{ created: false }`

### Requirement: 代码模板生成

`writeProblem` 落 `solution.<ext>` 时,SHALL 优先使用 `detail.codeSnippets[<langSlug>]` 内容;若缺失则写"注释占位":`// TODO: 在此处编写代码` 或对应语言注释语法。`solution.<ext>` 已存在时 MUST NOT 覆盖。

#### Scenario: LeetCode CN 模板
- **WHEN** `detail.codeSnippets.cpp === 'class Solution {...}'`,`defaultLang: 'cpp'`
- **THEN** `solution.cpp` 内容为该 snippet

#### Scenario: 无模板兜底
- **WHEN** `detail.codeSnippets` 缺 `python3`,`defaultLang: 'python3'`
- **THEN** `solution.py` 内容为 `# TODO: 在此处编写代码\n`

### Requirement: 刷新策略

`refresh(detail, problemDir)` SHALL 比较 `meta.json.updatedAt` 与 `detail.updatedAt`(远端无此字段时改比 `sha256(detail.statement)` 与 `meta.json.statementHash`)。远端较新时 MUST 覆盖 `problem.md / meta.json / cases/in_1.txt ... cases/in_N.txt / cases/out_1.txt ... cases/out_N.txt`,MUST NOT 覆盖 `solution.*`、`.build/`、编号大于 N 的用户自定义 case 文件。

#### Scenario: 远端更新
- **WHEN** `detail.updatedAt > meta.updatedAt`
- **THEN** `problem.md / meta.json / cases/in_1..N` 被覆盖;`solution.cpp` 内容不变;`cases/in_5.txt`(用户自定义)保留

#### Scenario: 远端无变化
- **WHEN** `detail.updatedAt === meta.updatedAt`
- **THEN** 任何文件都不被写;返回 `{ refreshed: false }`

### Requirement: 自定义样例

`addCustomCase(problemDir, input, output?)` SHALL 在 `cases/` 下追加 `in_<next>.txt`(`<next>` = 当前 `cases/` 下 `in_<n>.txt` 的最大编号 + 1);若 `output !== undefined` 也追加 `out_<next>.txt`。`meta.customCaseIndices` MUST 同步追加 `<next>`(去重);`meta.samples` MUST 不被修改。`meta.updatedAt` 刷新为当前 ISO 时间。返回新分配的编号。

`removeCustomCase(problemDir, index)` SHALL 仅在 `index` 出现在 `meta.customCaseIndices` 中时删除 `cases/in_<index>.txt` 与 `cases/out_<index>.txt`,并把 `index` 从 `customCaseIndices` 移除,刷新 `meta.updatedAt`,返回 `true`。否则不做任何修改,返回 `false`(这保证远端 sample 编号不会被误删)。

`refresh(detail, problemDir)` 在覆盖远端字段时 MUST 保留旧 `meta.customCaseIndices` 与编号 > N(N = 远端 sample 数)的用户自定义用例文件。

#### Scenario: 追加用例
- **WHEN** 已有 `in_1.txt`/`in_2.txt`(远端 sample),调 `addCustomCase(dir, '5\n', '5\n')`
- **THEN** 创建 `in_3.txt='5\n'`、`out_3.txt='5\n'`,`meta.customCaseIndices === [3]`,`meta.samples.length === 2`(不变),返回 `3`

#### Scenario: 删除自定义用例
- **WHEN** `meta.customCaseIndices = [3]`,调 `removeCustomCase(dir, 3)`
- **THEN** 删除 `cases/in_3.txt`、`cases/out_3.txt`,`meta.customCaseIndices === []`,返回 `true`

#### Scenario: 拒绝删除远端 sample 编号
- **WHEN** `meta.customCaseIndices = []`,调 `removeCustomCase(dir, 1)`
- **THEN** 不删除任何文件,返回 `false`

#### Scenario: refresh 保留自定义用例登记
- **WHEN** 已有 `customCaseIndices = [3]`,远端 statement 变化触发 `refresh(detail, dir)`(detail 有 2 个 sample)
- **THEN** `cases/in_3.txt`/`out_3.txt` 与 `meta.customCaseIndices` 保留;`cases/in_1..2.txt`/`out_1..2.txt` 被覆盖

### Requirement: 离线读取

`readMeta(problemDir)` SHALL 在 `meta.json` 缺失时返回 `undefined` 而非抛错;存在时 JSON 反序列化失败 MUST 返回 `undefined` 并通过 `LoggerBackend.warn` 记录错误。

#### Scenario: meta 不存在
- **WHEN** problemDir 中无 `meta.json`
- **THEN** `readMeta` 返回 `undefined`

#### Scenario: meta 损坏
- **WHEN** `meta.json` 不是合法 JSON
- **THEN** `readMeta` 返回 `undefined`,且 logger 输出 warn

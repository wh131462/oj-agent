## MODIFIED Requirements

### Requirement: 题面与样例落盘

`writeProblem(detail, opts)` SHALL 把 `detail` 序列化到目标目录:

- `problem.md`:`detail.statement`(Markdown,LF 换行)
- `meta.json`:JSON,字段 `{ platform, id, title, slug, url, difficulty, tags, samples, timeLimitMs?, memoryLimitKb?, codeSnippets?, fetchedAt, updatedAt, statementHash, customCaseIndices? }`
- `cases/in_1.txt` ~ `cases/in_<N>.txt`:对应 `detail.samples[].input`
- `cases/out_1.txt` ~ `cases/out_<N>.txt`:对应 `detail.samples[].output`(可空,空时仍创建 0 字节文件)

`meta.json.samples` MUST 始终只反映远端题面 sample;本地新增的自定义用例 MUST 通过 `meta.customCaseIndices: number[]` 单独登记,不写入 `samples`,以避免污染 AI 上下文与题面展示。`customCaseIndices` 为可选字段,旧 meta 缺省视为空数组。

所有写入 MUST 使用原子写(写临时文件 → rename),失败时不留破损文件。

#### Scenario: 写盘新题
- **WHEN** `writeProblem(detail, { rootDir: '~/oj' })` 首次执行,`detail` 含 2 个 sample
- **THEN** 在工作区目录下创建 `problem.md`/`meta.json`/`cases/in_1..2.txt`/`cases/out_1..2.txt`/`solution.<ext>` 且 `meta.customCaseIndices` 字段不存在或为空数组

#### Scenario: 二次写入幂等
- **WHEN** 同一道题再次执行 `writeProblem`,且远端字段未变
- **THEN** 既有文件按原子写覆盖,内容字节级一致(允许 `meta.updatedAt` 更新)

### Requirement: 自定义样例

`addCustomCase(problemDir, input, output?)` SHALL 在 `cases/` 下追加 `in_<next>.txt`(`<next>` = 当前 `cases/` 下 `in_<n>.txt` 的最大编号 + 1);若 `output !== undefined` 也追加 `out_<next>.txt`。`meta.customCaseIndices` MUST 同步追加 `<next>`(去重);`meta.samples` MUST 不被修改。`meta.updatedAt` 刷新为当前 ISO 时间。返回新分配的编号。

`removeCustomCase(problemDir, index)` SHALL 仅在 `index` 出现在 `meta.customCaseIndices` 中时删除 `cases/in_<index>.txt` 与 `cases/out_<index>.txt`,并把 `index` 从 `customCaseIndices` 移除,刷新 `meta.updatedAt`,返回 `true`。否则不做任何修改,返回 `false`。

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

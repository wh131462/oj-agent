## ADDED Requirements

### Requirement: HDOJ 适配器实现

`@oj-agent/core` SHALL 提供 `HDOJAdapter implements PlatformAdapter`,其 `id === 'hdoj'`,基于 `http://acm.hdu.edu.cn/` 站点的 HTML 爬取与 GBK 编码表单实现 5 个方法。所有响应 MUST 使用 `responseEncoding: 'gbk'`,所有 form 提交 MUST 使用 `formEncoding: 'gbk'`。

#### Scenario: 出网编码正确
- **WHEN** 调用 `adapter.getProblem('1000')`
- **THEN** 出网请求 `HttpClient` 选项中 `responseEncoding === 'gbk'`,响应 `text` 中中文正常显示

### Requirement: 题目列表

`listProblems(query)` SHALL 抓取 `http://acm.hdu.edu.cn/listproblem.php?vol=<n>`,使用 lazy import 的 `cheerio` 解析 `<tr>`,映射为 `PlatformProblemSummary`:
- `id` ← 第一个 `<td>` 中的纯数字
- `title` ← 题目链接文字
- `difficulty` ← 由通过率(AC/Submit)推断:`<10%` Hard、`10-30%` Medium、`>30%` Easy
- `url` ← `http://acm.hdu.edu.cn/showproblem.php?pid=<id>`

`query.page` 映射到 `vol`,`pageSize` 默认 100(HDOJ 单页固定 100 题,小于 100 时本地截断)。

#### Scenario: 分页
- **WHEN** `listProblems({ page: 2, pageSize: 100 })`
- **THEN** 出网 URL 为 `http://acm.hdu.edu.cn/listproblem.php?vol=2`

#### Scenario: 难度推断
- **WHEN** 某题 AC=50,Submit=1000(5%)
- **THEN** 该 summary `difficulty === 'Hard'`

### Requirement: 题目详情

`getProblem(pid)` SHALL 抓 `showproblem.php?pid=<pid>`,按 H1 锚点 `Problem Description / Input / Output / Sample Input / Sample Output / Hint` 抽取各段落,转 Markdown:
- 段标题降级为 Markdown `### ` 子标题
- `<pre>` 段保留为 fenced code block(无语言标签)
- 数学公式(若含 `<sub>/<sup>/<i>`) MUST 转 KaTeX 表达式 `$..$`
- `Sample Input` 与 `Sample Output` 段中的多组 `<pre>` 按出现顺序两两配对生成 `samples`

#### Scenario: 多组样例
- **WHEN** 题面 `Sample Input` 段含 2 个 `<pre>`,`Sample Output` 段含 2 个 `<pre>`
- **THEN** `samples.length === 2`,顺序对齐

#### Scenario: 题面解析降级
- **WHEN** HDOJ 改版导致段标题失配
- **THEN** 抛 `AdapterError('PARSE_ERROR')`,`message` 包含失败段名

### Requirement: 登录

`login()` MUST NOT 启动 UI;前端 SHALL 把已获取的 cookie 通过 `credentialStore.set('hdoj', { cookie: 'PHPSESSID=...' })` 写入。`login()` 在 core 内 SHALL 抛 `AdapterError('AUTH_REQUIRED', '请通过前端登录入口完成 HDOJ 登录后写入凭证')`。

#### Scenario: 直接调 login 拒绝
- **WHEN** 调 `adapter.login()`
- **THEN** 抛 `AdapterError('AUTH_REQUIRED')`,提示信息引导前端流程

### Requirement: 提交

`submit(pid, lang, code)` SHALL 校验登录态,然后 `POST http://acm.hdu.edu.cn/submit.php?action=submit` GBK 表单 `{ problemid: pid, language: <数字 ID>, usercode: code, check: '0' }`,需带 `Referer: http://acm.hdu.edu.cn/submit.php?pid=<pid>`。

M1 语言映射(实际数值以平台当前为准,实现时二次校对):
- `cpp` → `0` (C++)
- `c` → `3`
- `java` → `5`
- `python3` → `11`

未映射 MUST 抛 `AdapterError('LANG_UNSUPPORTED')`。

返回值 `submissionId` 为提交后查询 `status.php?user=<u>` 首行的 RunID(字符串)。

#### Scenario: 中文代码提交
- **WHEN** `usercode` 含中文注释,`adapter.submit('1000', 'cpp', code)`
- **THEN** 出网 body 中中文为 GBK 字节序列;`Content-Type` 头包含 `charset=gbk`

#### Scenario: 未登录被拒
- **WHEN** 无 cookie 调 `submit`
- **THEN** 抛 `AdapterError('AUTH_REQUIRED')`,不出网

### Requirement: 结果轮询

`pollResult(sid)` SHALL 抓取 `status.php?user=<username>&pid=<pid>&first=&noprivate=1`,取首行 `<tr>` 的状态文字与 RunID,匹配 `sid` 后映射 verdict:

- `Accepted` → `AC`
- `Wrong Answer` → `WA`
- `Time Limit Exceeded` → `TLE`
- `Memory Limit Exceeded` → `MLE`
- `Runtime Error` → `RE`
- `Output Limit Exceeded` → `WA`
- `Presentation Error` → `PE`
- `Compilation Error` → `CE`(同时拉取 `viewerror.php?rid=<sid>` 填充 `compileError`)
- `Queuing | Compiling | Running` → `JUDGING`,继续轮询
- 其他 → `UNKNOWN`

退避 `[1000, 2000, 3000, 5000, 5000, ...]`,总超时 60s。

#### Scenario: 轮询到 AC
- **WHEN** status 页首行 RunID 匹配 `sid`,状态为 `Accepted`,Time `120MS`,Memory `1456K`
- **THEN** 返回 `{ verdict: 'AC', timeMs: 120, memoryKb: 1456 }`

#### Scenario: 编译错误详情
- **WHEN** 状态为 `Compilation Error`
- **THEN** 额外调用 `viewerror.php?rid=<sid>`,把 `<pre>` 内容填入 `compileError`

#### Scenario: 60s 超时
- **WHEN** 持续 `Queuing` > 60s
- **THEN** 抛 `AdapterError('JUDGING_TIMEOUT')`

### Requirement: GBK 中文 corner case

`HDOJAdapter` 提交时遇到 `iconv-lite.encode` 无法表示的字符(罕见字 / emoji),SHALL 抛 `AdapterError('PLATFORM_ERROR', '代码含 GBK 不支持的字符: <字符>')`,MUST NOT 静默替换为 `?`。

#### Scenario: emoji 拒绝
- **WHEN** 代码含 `// 🚀`
- **THEN** 抛 `AdapterError('PLATFORM_ERROR')`,message 指出问题字符

## ADDED Requirements

### Requirement: HTML 抓取与编码

系统 SHALL 通过 `https://acm.hdu.edu.cn` 抓取页面。所有响应 MUST 以 GBK 解码（`iconv-lite`），所有 POST 表单 MUST 以 GBK 编码后写入请求体。`HttpClient` MUST 在调用方传入 `responseEncoding:'gbk'` 与 `formEncoding:'gbk'` 时分别完成解 / 编码。

#### Scenario: 中文题面正确显示

- **WHEN** 调用 `hdojAdapter.getProblem('1000')` 抓回 `problemshow.php?pid=1000`
- **THEN** 返回的 `ProblemDetail.markdown` 中中文字符 SHALL 与浏览器渲染一致，无乱码

### Requirement: 列表抓取

`listProblems` MUST 抓取 `listproblem.php?vol=<n>`，并通过 `cheerio` 解析每行得到 `id`、`title`、`通过率`、`提交数`。`difficulty` MUST 由通过率推断：`>50%→easy`、`20-50%→medium`、`<20%→hard`。`page` 参数 MUST 映射到 `vol`（每 vol 约 100 题）。

#### Scenario: 翻页

- **WHEN** 调用 `listProblems({ page:2, pageSize:100 })`
- **THEN** 适配器请求 `listproblem.php?vol=2`，返回该卷的 100 道题目摘要

### Requirement: 题面与样例解析

`getProblem(id)` MUST 抓取 `showproblem.php?pid=<id>`，从 `panel_content` 中按顺序提取「Problem Description / Input / Output / Sample Input / Sample Output / Source」。`samples[]` MUST 从 `<pre>` 中按出现顺序两两配对。当解析失败 MUST 按 `platform-adapter` 规范抛出 `PARSE_FAILED`。

#### Scenario: 多样例解析

- **WHEN** 题面包含 2 组 Sample Input / Sample Output 块
- **THEN** `samples` 长度 SHALL 等于 2，且 `samples[i].input/output` 与原文一一对应

### Requirement: 登录与提交

登录 MUST 通过 `userloginex.php` 表单 POST（`username/userpass/login=Sign In`），成功后 `PHPSESSID` Cookie SHALL 由 `auth-manager` 落盘。`submit` MUST POST `submit.php` 表单 `{ problemid, language, usercode, check=0 }`，`language` 数值 ID 按静态表：`0=G++、1=GCC、2=C++、3=C、5=Java`，C++ 默认 0，JavaScript 不支持（抛 `PLATFORM_ERROR`）。

#### Scenario: 提交 Java

- **WHEN** `submit('1000','java',code)`
- **THEN** 请求体 `language=5`，编码为 GBK，`Cookie` 头携带 `PHPSESSID`

### Requirement: 状态查询

`pollResult` MUST 抓取 `status.php?user=<currentUser>&pid=<id>` 并取列表首行作为最新提交。verdict 映射：`Accepted→AC`、`Wrong Answer→WA`、`Time Limit Exceeded→TLE`、`Memory Limit Exceeded→MLE`、`Runtime Error→RE`、`Compilation Error→CE`、`Presentation Error→PE`、`Output Limit Exceeded→OLE`，`Queuing/Running` 视为 `PENDING`。当 60 秒内未拿到非 PENDING 状态时返回 `JudgeResult { state:'TIMEOUT', verdict:'UNKNOWN' }`。

#### Scenario: 轮询到 AC

- **WHEN** 第 4 次轮询拿到 `Accepted`
- **THEN** 返回 `{ state:'DONE', verdict:'AC', timeMs, memoryKb }`，且 `onProgress` 在每次轮询时被调用

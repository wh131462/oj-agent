## ADDED Requirements

### Requirement: LeetCode CN 适配器实现

`@oj-agent/core` SHALL 提供 `LeetCodeCnAdapter implements PlatformAdapter`,其 `id === 'leetcode-cn'`,实现以下端点调用:

- 列表:`POST https://leetcode.cn/graphql/`,query `problemsetQuestionList`
- 详情:`POST https://leetcode.cn/graphql/`,query `questionData(titleSlug: <slug>)`
- 提交:`POST https://leetcode.cn/problems/<slug>/submit/`
- 轮询:`GET https://leetcode.cn/submissions/detail/<id>/check/`

所有请求 MUST 设置 `Referer: https://leetcode.cn/`、`Origin: https://leetcode.cn`、`Content-Type: application/json`(submit/查询)或 `application/json`(GraphQL);写操作 MUST 携带 `X-CSRFToken`(取自当前 cookie 中的 `csrftoken`)。

#### Scenario: 必备请求头注入
- **WHEN** 调用 `adapter.getProblem('two-sum')`
- **THEN** 出网请求头包含 `Referer / Origin / Content-Type`,body 为合法 GraphQL JSON,无 `X-CSRFToken`(只读不需要)

#### Scenario: submit 携带 CSRF
- **WHEN** cookie 包含 `csrftoken=ABC`,调用 `adapter.submit('two-sum', 'cpp', '...')`
- **THEN** 出网请求头 `X-CSRFToken: ABC`,body JSON 包含 `{ lang: 'cpp', question_id: <数字>, typed_code: '...' }`

### Requirement: 题目列表

`listProblems(query)` SHALL 调用 `problemsetQuestionList` GraphQL,把每条 `question` 映射为 `PlatformProblemSummary`:
- `id` ← `questionFrontendId`(字符串)
- `title` ← `translatedTitle || title`
- `difficulty` ← `'Easy' | 'Medium' | 'Hard'`
- `tags` ← `topicTags.map(t => t.translatedName || t.name)`
- `url` ← `https://leetcode.cn/problems/<titleSlug>/`

支持 `query.page / query.pageSize / query.keyword / query.difficulty / query.tags`。

#### Scenario: 关键字筛选
- **WHEN** `listProblems({ keyword: '两数', page: 1, pageSize: 50 })`
- **THEN** GraphQL variables 中 `filters.searchKeywords === '两数'`,`skip === 0`,`limit === 50`

#### Scenario: 难度筛选
- **WHEN** `listProblems({ difficulty: 'Easy' })`
- **THEN** GraphQL variables 中 `filters.difficulty === 'EASY'`

### Requirement: 题目详情

`getProblem(slug)` SHALL 调用 `questionData(titleSlug)` GraphQL,返回 `PlatformProblemDetail`:
- `statement` ← `translatedContent` 经 HTML→Markdown 转换,保留 `<pre>` 为 fenced code block,`<sup>/<sub>` 转 `$x^y$` / `$x_y$`
- `samples` ← 解析 `exampleTestcases`(换行分隔字符串)按 `metaData.params.length` 切分;若为空则降级从 `translatedContent` 抽取
- `codeSnippets` ← `Object.fromEntries(question.codeSnippets.map(s => [s.langSlug, s.code]))`
- `timeLimitMs / memoryLimitKb` ← 不可得时省略

#### Scenario: 样例解析
- **WHEN** `exampleTestcases === '[2,7,11,15]\n9\n[3,2,4]\n6'`,`metaData.params.length === 2`
- **THEN** `samples` 长度为 2,第一组 input 为 `'[2,7,11,15]\\n9'`,output 为 `metaData` 中对应字段或空字符串

#### Scenario: 模板暴露
- **WHEN** 题目含 `cpp / python3 / java / javascript` 四种 snippet
- **THEN** `codeSnippets` 至少包含这 4 个 langSlug 键

### Requirement: 提交与语言映射

`submit(slug, lang, code)` SHALL 维护 M1 语言映射表:`cpp / python3 / java / javascript`(均为 LeetCode `langSlug`)。未在表中的 `lang` MUST 抛 `AdapterError('LANG_UNSUPPORTED')`。`submit` 返回值为 `String(submission_id)`。

#### Scenario: 未映射语言
- **WHEN** `submit('two-sum', 'go', '...')` 且 M1 不支持 go
- **THEN** 抛 `AdapterError`,`code === 'LANG_UNSUPPORTED'`

#### Scenario: 返回 submission_id
- **WHEN** 平台 POST 响应 `{ submission_id: 1234567 }`
- **THEN** 方法返回 `'1234567'`(字符串)

### Requirement: 结果轮询

`pollResult(sid)` SHALL 调用 `GET /submissions/detail/<sid>/check/`,按以下规则映射:

- `state === 'PENDING' | 'STARTED'` → `verdict: 'JUDGING'`,继续轮询
- `state === 'SUCCESS'`:按 `status_msg` 映射 verdict:
  - `Accepted` → `AC`
  - `Wrong Answer` → `WA`
  - `Time Limit Exceeded` → `TLE`
  - `Memory Limit Exceeded` → `MLE`
  - `Runtime Error` → `RE`
  - `Compile Error` → `CE`(同时填充 `compileError` 字段)
  - 其他 → `UNKNOWN`

轮询退避序列 `[1000, 2000, 3000, 5000, 5000, 5000, ...]`,总超时 60s,超时 MUST 抛 `AdapterError('JUDGING_TIMEOUT')`。

#### Scenario: 直到 AC
- **WHEN** 轮询响应依次为 `state=PENDING / STARTED / SUCCESS&status_msg=Accepted`
- **THEN** `pollResult` 最终返回 `{ verdict: 'AC', ... }`

#### Scenario: CE 详情透传
- **WHEN** `status_msg === 'Compile Error'`,`full_compile_error === "expected ';'"`
- **THEN** 返回值 `verdict === 'CE'`,`compileError === "expected ';'"`

#### Scenario: 60s 超时
- **WHEN** 平台持续返回 `state=PENDING` 超过 60s
- **THEN** 抛 `AdapterError('JUDGING_TIMEOUT', ..., retriable=false)`

### Requirement: 未登录拒绝

`submit` 与 `pollResult` 调用前 SHALL 校验 `credentialStore.get('leetcode-cn')`,不存在则立即抛 `AdapterError('AUTH_REQUIRED')`,MUST NOT 出网。`listProblems / getProblem` 对未登录态 MUST 容忍(LeetCode CN 允许匿名读取)。

#### Scenario: 匿名读列表
- **WHEN** 凭证不存在,调用 `listProblems({})`
- **THEN** 请求正常出网,不抛 `AUTH_REQUIRED`

#### Scenario: 匿名提交被拒
- **WHEN** 凭证不存在,调用 `submit(...)`
- **THEN** 抛 `AdapterError('AUTH_REQUIRED')`,不发起任何 HTTP 请求

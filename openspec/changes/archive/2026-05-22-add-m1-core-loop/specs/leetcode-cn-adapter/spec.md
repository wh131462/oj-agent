## ADDED Requirements

### Requirement: GraphQL 端点

系统 SHALL 通过 `https://leetcode.cn/graphql/` 与 LeetCode CN 通信。所有请求 MUST 携带 `Cookie: LEETCODE_SESSION=...; csrftoken=...`、`X-CSRFToken: <csrftoken>`、`Referer: https://leetcode.cn/...`、`Origin: https://leetcode.cn`。

#### Scenario: 缺少 csrftoken 时拒绝请求

- **WHEN** 调用任意写操作（如 `submit`）但 `CredentialStore.get('leetcode-cn')` 未返回 `csrftoken`
- **THEN** 适配器 MUST 抛出 `AdapterError { code: 'UNAUTHENTICATED' }`，不发起 HTTP 请求

### Requirement: 题库列表

`listProblems` MUST 调用 `problemsetQuestionList` GraphQL，传入 `{ categorySlug, skip, limit, filters: { difficulty?, tags?, searchKeywords? } }`，返回结果 MUST 映射为 `ProblemSummary[]`。`id` 字段 MUST 使用 `questionFrontendId`（用户可见编号），`slug` MUST 使用 `titleSlug`。

#### Scenario: 关键字搜索

- **WHEN** 上层调用 `listProblems({ page:1, pageSize:20, keyword:'两数之和' })`
- **THEN** 适配器以 `searchKeywords='两数之和'` 调用 GraphQL，返回包含「两数之和」题目的 `ProblemSummary[]`

### Requirement: 题目详情与样例

`getProblem(slug)` MUST 通过 `questionData` GraphQL 拉取 `translatedContent`、`exampleTestcases`、`codeSnippets`、`sampleTestCase`、`difficulty`、`topicTags`、`metaData`。`markdown` MUST 由 `translatedContent`（HTML）经统一转换得到。`samples[]` MUST 以 `exampleTestcases` 优先；若为空则解析 `translatedContent` 中的 `Example` 块作为兜底。

#### Scenario: 提取 Python 模板

- **WHEN** 调用 `getProblem('two-sum')` 并查询返回的 `codeSnippets`
- **THEN** `codeSnippets['python3']` SHALL 等于 GraphQL 中 `langSlug='python3'` 对应的 `code` 字段

### Requirement: 提交与轮询

`submit` MUST 调用 `https://leetcode.cn/problems/<slug>/submit/`，请求体 `{ question_id, lang, typed_code }`，响应取 `submission_id`。`pollResult` MUST 轮询 `https://leetcode.cn/submissions/detail/<id>/check/`，直至 `state === 'SUCCESS'` 或超时。verdict 映射 MUST 按 LeetCode 的 `status_msg`：`Accepted→AC`、`Wrong Answer→WA`、`Time Limit Exceeded→TLE`、`Memory Limit Exceeded→MLE`、`Runtime Error→RE`、`Compile Error→CE`，其他归 `UNKNOWN`。

#### Scenario: 提交成功并轮询到 AC

- **WHEN** 提交 `lang='python3'`、`code` 正确，pollResult 第 3 次拿到 `state=SUCCESS, status_msg=Accepted`
- **THEN** `pollResult` MUST 返回 `{ state:'DONE', verdict:'AC', timeMs, memoryKb }`，且过程中按指数退避调用 `onProgress`

#### Scenario: 编译错误返回详细信息

- **WHEN** 平台返回 `status_msg='Compile Error'` 且含 `full_compile_error`
- **THEN** `JudgeResult.detail` MUST 包含 `full_compile_error` 文本，UI 层可据此渲染

### Requirement: 语言映射

适配器 MUST 维护 `LanguageId → langSlug` 静态映射表：`cpp→cpp`、`python→python3`、`java→java`、`javascript→javascript`。若用户选择未映射语言，MUST 抛出 `AdapterError { code: 'PLATFORM_ERROR', message:'此语言在 LeetCode CN 不可用' }`。

#### Scenario: 不支持的语言

- **WHEN** 调用 `submit(id, 'rust', code)` 而映射表无 `rust`
- **THEN** 抛出 `PLATFORM_ERROR`，不发起 HTTP 请求

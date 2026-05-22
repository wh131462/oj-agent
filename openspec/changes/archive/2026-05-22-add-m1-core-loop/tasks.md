## 1. 基础设施与依赖

- [ ] 1.1 在 `package.json` 添加运行时依赖：`iconv-lite`、`cheerio`、`markdown-it`、`markdown-it-katex`、`katex`
- [ ] 1.2 在 `package.json` 添加配置项：`ojAgent.workspace.root`、`ojAgent.http.<platform>.rateLimit`、`ojAgent.lang.*`、`ojAgent.judge.timeoutMs`、`ojAgent.submission.pollTimeoutMs`、`ojAgent.submission.minIntervalMs`
- [ ] 1.3 在 `package.json` 注册 M1 命令清单（拉取 / 运行 / 添加用例 / 提交 / 打开题面 / 登录 / 登出 / 切换工作区根目录）与视图 `ojAgent.problems`
- [ ] 1.4 创建源码目录骨架：`src/core/platform/{types.ts,registry.ts,leetcode-cn/,hdoj/}`、`src/core/auth/`、`src/core/http/{client.ts,encoding.ts}`、`src/core/workspace/`、`src/core/judge/`、`src/core/submission/`、`src/extension/views/{tree.ts,problem-webview.ts,result-panel.ts}`

## 2. http-client 公共层

- [ ] 2.1 实现 `HttpClient.request(options)`：基于全局 `fetch`，支持 `headers/body/query/timeoutMs/signal`
- [ ] 2.2 集成限速：扩展现有 `src/core/http/rate-limiter.ts`，按 `platformId` 维护独立 token-bucket，并允许 `AbortSignal` 取消等待
- [ ] 2.3 接入 `iconv-lite` 实现 `responseEncoding='gbk'` 与 `formEncoding='gbk'`（含中文 form body GBK 编码）
- [ ] 2.4 实现 Cookie 注入与 `Set-Cookie` 回写到 `CredentialStore`，含 HttpOnly/Path 弱解析
- [ ] 2.5 实现超时与幂等重试（GET / HEAD 默认 2 次指数退避，POST 默认关闭）
- [ ] 2.6 读取 `http.proxy` 并通过 `undici.ProxyAgent` 透传
- [ ] 2.7 单测：GBK 双向转码、限速队列、Cookie 注入、超时分支、POST 不重试

## 3. auth-manager 凭证管理

- [ ] 3.1 设计 `CredentialStore`：`get/set/delete/onChange`，键名 `oj.cookie.<platform>`，与 `ai.apiKey.*` 隔离
- [ ] 3.2 实现「登录 HDOJ」Webview 流程：加载 `userloginex.php`，注入脚本回传 `document.cookie`，宿主校验 `PHPSESSID` 并落盘
- [ ] 3.3 实现「登录 LeetCode CN」QuickInput 流程：分两步收集 `LEETCODE_SESSION`、`csrftoken`，调用 `userStatus` GraphQL 校验
- [ ] 3.4 实现登录状态探活：启动时与每次需要登录的请求前检测，失效在状态栏标记 ⚠
- [ ] 3.5 实现 `OJ-Agent` 状态栏聚合项与 QuickPick 操作（登录 / 登出 / 重新登录）
- [ ] 3.6 实现「登出」命令：清理 SecretStorage 与对应 HttpClient 缓存
- [ ] 3.7 单测：CredentialStore 隔离、Cookie 解析、失效探活

## 4. platform-adapter 与数据模型

- [ ] 4.1 定义 `PlatformAdapter` 接口、`ProblemSummary`、`ProblemDetail`、`SubmissionId`、`JudgeResult`、`AdapterError`、`Pageable<T>` 类型
- [ ] 4.2 实现 `PlatformAdapterRegistry`：构造时注入 `HttpClient` + `CredentialStore`，按 id 返回实例
- [ ] 4.3 实现错误归一化辅助函数：HTTP 状态码 → `AdapterError.code` 映射
- [ ] 4.4 单测：注册 / 取实例 / 未登录拒绝调用

## 5. leetcode-cn-adapter

- [ ] 5.1 封装 `LeetCodeCnGraphQLClient`：自动注入 Cookie、`X-CSRFToken`、`Referer`、`Origin`，未登录写操作拒绝
- [ ] 5.2 实现 `listProblems`：调用 `problemsetQuestionList`，映射到 `ProblemSummary[]`（使用 `questionFrontendId` 作 id）
- [ ] 5.3 实现 `getProblem`：调用 `questionData`，从 `translatedContent` HTML 转 Markdown、抽取 `exampleTestcases`、`codeSnippets`、`metaData`
- [ ] 5.4 实现样例兜底解析：`exampleTestcases` 为空时解析 HTML 的 `Example` 块
- [ ] 5.5 实现 `submit`：POST `/problems/<slug>/submit/`，按映射表填 `lang`、`question_id`
- [ ] 5.6 实现 `pollResult`：轮询 `submissions/detail/<id>/check/`，verdict 映射，含 `full_compile_error` 透传
- [ ] 5.7 静态语言映射表（cpp/python3/java/javascript）+ 未映射时抛 `PLATFORM_ERROR`
- [ ] 5.8 单测：mock GraphQL / submit / poll 全流程；语言映射；CE 详细信息透传

## 6. hdoj-adapter

- [ ] 6.1 实现 `listProblems`：抓 `listproblem.php?vol=<n>`，`cheerio` 提取行，通过率推断难度
- [ ] 6.2 实现 `getProblem`：抓 `showproblem.php?pid=<id>`，按段抽取并转 Markdown，样例两两配对
- [ ] 6.3 实现 `submit`：构造 GBK 表单 `{problemid, language, usercode, check:0}`
- [ ] 6.4 实现 `pollResult`：抓 `status.php?user=<u>&pid=<id>` 首行；verdict 映射；60s 超时
- [ ] 6.5 静态语言 ID 表（C++=0、Java=5、Python=…按平台 ID 校对），未支持语言抛 `PLATFORM_ERROR`
- [ ] 6.6 单测：mock HTML（中文 + GBK 编码）、列表解析、题面与样例解析、提交编码、状态解析

## 7. problem-workspace

- [ ] 7.1 ���现 `WorkspaceManager.resolveProblemDir(platform, id, slug)`：生成 `<root>/<platform>/<id>-<slug>-<YYYY-MM-DD>/`
- [ ] 7.2 实现拉取写入：`problem.md`、`meta.json`、`cases/in_<n>.txt`、`cases/out_<n>.txt`
- [ ] 7.3 实现 `solution.<ext>` 写入并保证已存在时不覆盖；缺模板时写注释占位
- [ ] 7.4 实现「刷新题面」：按 `updatedAt` 对比仅刷新 `problem.md/meta.json/cases/*`，保留 `solution.*`
- [ ] 7.5 实现离线读取：优先用本地缓存渲染题面
- [ ] 7.6 实现「添加自定义用例」命令：追加 `cases/in_<n>.txt`/`out_<n>.txt`，同步更新 `meta.json.samples`
- [ ] 7.7 单测：目录命名、slug 归一化、不覆盖 solution、自定义用例追加

## 8. judge-runner 本地判题

- [ ] 8.1 实现工具链探测：`g++/python3/javac/java/node` 的 `which/where`，缓存到 `globalState.toolchain`，Output Channel 打印
- [ ] 8.2 实现编译命令模板渲染：`{src} {out} {dir} {main}` 占位符替换
- [ ] 8.3 实现编译产物缓存：`sha256(src + compileCmd)` 写入 `<problemDir>/.build/`，命中跳过编译
- [ ] 8.4 实现用例执行：`spawn` + stdin 写入 + stdout/stderr 捕获 + 超时 SIGKILL
- [ ] 8.5 实现输出归一化：每行 `rstrip` + 末尾空行去除；逐字节比对并记录首处差异行列
- [ ] 8.6 实现结果面板 Webview：编号 / verdict / 耗时 / 内存 / 折叠 input / expected / actual / unified diff
- [ ] 8.7 在失败用例旁挂载「解释错因」按钮（参数附 `caseIndex`）
- [ ] 8.8 单测：归一化（行尾空格、末尾换行）、超时分支、缓存命中、diff 首处差异定位

## 9. submission-runner 在线提交

- [ ] 9.1 实现 `submitCurrent` 命令：从活动文件推导平台 / 题号 / 语言
- [ ] 9.2 集成登录校验，未登录跳登录流程
- [ ] 9.3 集成最小间隔（默认 5s）确认对话框
- [ ] 9.4 调用适配器 `submit`，立即在状态栏显示 `Judging…` + spinner
- [ ] 9.5 启动 `pollResult`（退避 `[1,2,3,5,5,…]`，总超时 60s），onProgress 实时刷新状态栏与结果面板
- [ ] 9.6 结果面板渲染最终 verdict、耗时、内存、外部链接；CE 完整透传
- [ ] 9.7 5s 后切短文本、再 10s 后隐藏状态栏；点击状态栏打开结果面板
- [ ] 9.8 单测：未登录拦截、最小间隔拦截、状态变化序列、CE 透传

## 10. problem-ui 题库与题面

- [ ] 10.1 实现 TreeView `ojAgent.problems`：第一层平台、第二层题目；难度图标；分页/loading
- [ ] 10.2 实现工具栏命令：搜索 / 难度筛选 / 标签筛选 / 上一页 / 下一页，筛选条件持久化到 `workspaceState`
- [ ] 10.3 实现题目右键菜单：拉取到本地 / 在浏览器打开 / 复制题号
- [ ] 10.4 实现题面 Webview：`markdown-it + katex` 渲染 `problem.md`；工具栏运行 / 提交 / 刷新 / 打开代码 + 4 个 AI 按钮
- [ ] 10.5 Webview ↔ 宿主消息协议：`postMessage` 路由到对应命令
- [ ] 10.6 实现 `OJ-Agent: 拉取题目（按 URL）`：识别 LeetCode CN / HDOJ URL，解析后走拉取流程

## 11. AI 联动（ai-assistant 增量）

- [ ] 11.1 实现 `ProblemContextProvider.get(problemRef)`：从工作区与适配器组装 `ProblemContext`
- [ ] 11.2 实现 `TestCaseContextProvider.get(problemRef, caseIndex)`：组装 `TestCaseContext`（含 input/expected/actual/diffSummary/verdict/language/sourceCode）
- [ ] 11.3 在题面 Webview 与测试结果面板挂载四个 AI 入口，按 `ai-assistant` 既有规范处理禁用态
- [ ] 11.4 监听 `ojAgent.ai.activeProfileId` 变化并刷新按钮状态
- [ ] 11.5 单测 / 集成：上下文打包字段完整、按钮禁用切换

## 12. 端到端冒烟与发布准备

- [ ] 12.1 LeetCode CN 端到端：登录 → 列表 → 拉取「两数之和」→ 运行样例 → 提交 → 看到 AC
- [ ] 12.2 HDOJ 端到端：登录 → 列表 → 拉取 PID=1000 → 运行样例 → 提交 → 看到 AC
- [ ] 12.3 断网场景：拉取过的题目仍可打开题面与历史用例
- [ ] 12.4 工具链缺失场景：提示与跳转链接
- [ ] 12.5 在 README 增加 M1 功能说明与首次使用指引（仅扩展 README，不新增独立 docs 文件）
- [ ] 12.6 更新 `CHANGELOG`（若仓库已有），标记 v0.2.0 M1 核心闭环

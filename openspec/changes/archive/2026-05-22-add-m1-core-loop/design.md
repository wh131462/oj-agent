## Context

OJ-Agent 当前已上线 AI 助手模块（见 `openspec/specs/ai-assistant`、`openspec/specs/model-provider`）。M1 阶段需在 LeetCode CN（GraphQL）与 HDOJ（HTML + GBK）两个平台上跑通核心闭环：「题库浏览 → 拉取题面 → 本地测试 → 在线提交 → 查看结果」。

约束：
- 运行环境为 VSCode 扩展（Node 18+，TypeScript），不允许引入需要原生编译的依赖。
- 凭证仅存 `SecretStorage`，AI Key 与 OJ Cookie 命名空间隔离。
- 不允许直接 `fetch`，统一走限速 / Cookie 注入的 `http-client`，并能切换 Webview 内代发以绕过 Cloudflare（M1 实际仅 HDOJ 需要简易 Cookie 注入，LeetCode CN 走 GraphQL）。
- 用户工作区目录格式已确定：`workspace/<platform>/<id>-<slug>-<YYYY-MM-DD>/`。

干系人：算法竞赛 / 课程作业 / 求职刷题用户。

## Goals / Non-Goals

**Goals:**
- 在 LeetCode CN + HDOJ 两平台跑通完整闭环，使插件成为可演示原型。
- 抽象出可复用的 `PlatformAdapter` 接口与 `http-client` 公共层，为 M2/M3 平台接入降低成本。
- 保证扩展可在不连网时打开已拉取题目、查看缓存样例、查看历史本地测试结果。
- 与已有 AI 助手能力无缝联动：题面 / 测试结果面板直接调用既有命令。

**Non-Goals:**
- 不实现 Codeforces、洛谷、POJ、蓝桥云课接入（M2/M3）。
- 不做 Special Judge 的本地完整模拟，仅做远程提交即可。
- 不做竞赛实时排名 / 计时器、题解社区。
- 不替换或重写已有的 AI 助手实现，仅扩展上下文挂载点。

## Decisions

### D1：平台适配器统一接口

采用 PRD 6.2 草案的 `PlatformAdapter`：
```ts
interface PlatformAdapter {
  id: 'leetcode-cn' | 'hdoj';
  login(): Promise<Credential>;          // 通过 auth-manager 完成
  listProblems(query: ListQuery): Promise<Pageable<ProblemSummary>>;
  getProblem(id: string): Promise<ProblemDetail>;
  submit(id: string, lang: LanguageId, code: string): Promise<SubmissionId>;
  pollResult(sid: SubmissionId, onProgress?: (r: JudgeResult) => void): Promise<JudgeResult>;
}
```
- 适配器只关心协议细节，凭证与限速由外部注入（构造函数）。
- 错误归一化为 `AdapterError { code, message, retriable, source }`，UI 层只看 code。

**备选**：每平台各自暴露独特接口 → 否决，UI 会被平台细节污染。

### D2：HTTP 客户端层

封装 `HttpClient`：限速队列（每平台独立 token-bucket）、超时、重试（指数退避，仅幂等请求）、Cookie 注入（`SecretStorage` 读取，每平台命名空间）、`Accept-Encoding` 自动 gzip、代理透传（沿用 VSCode `http.proxy`）。GBK 解码通过 `iconv-lite`，由调用方在 `responseEncoding` 选项中显式声明。

底层使用 Node 18 内置 `fetch`（undici），不引入 `axios`。流式响应通过 `Response.body`（`ReadableStream`）逐行读取。

**备选**：直接用 `axios` → 体积大、与 AI 模块已用的 fetch 不一致。

### D3：登录与凭证

复用 VSCode `WebviewPanel` 打开平台登录页，监听 `webview.cookieStore` 或注入 `chrome.webRequest` 不可行；改用 `WebviewPanel` 配合 `vscode.env.openExternal` + 引导用户在 webview 内登录后，由扩展通过 `electron`'s `ses.cookies` 不可用 → **改用** `WebviewPanel` 加载平台域名后由 webview 脚本 `document.cookie` 回传扩展宿主。注：HttpOnly cookie 无法读到，故 LeetCode CN 改用账号密码登录的 GraphQL `mutation` 路径不稳定；最终采用：
- **方案 A（LeetCode CN）**：用户在系统浏览器登录后，复制并粘贴 `LEETCODE_SESSION` + `csrftoken` 到设置面板，扩展校验有效性后存 SecretStorage。
- **方案 B（HDOJ）**：扩展内 webview 加载 HDOJ 登录页，用户提交表单后扩展通过 `webview.postMessage` 接收 `document.cookie`（HDOJ Cookie 非 HttpOnly），随后扩展接管请求。

**理由**：M1 优先打通流程，不投入 Cloudflare 反爬绕过；待 M2 接入 Codeforces / 洛谷时统一升级登录方案。

### D4：题面 Webview 渲染

- Markdown 渲染：`markdown-it` + `markdown-it-katex`；HDOJ 原始 HTML 通过 `cheerio` 抽取并转 Markdown（保留 `<pre>` 段落作为样例）。
- 样例解析：LeetCode CN 走 `exampleTestcases`（字符串数组）；HDOJ 抓 `<pre>` 块中 Sample Input / Sample Output。
- 渲染层与扩展宿主通过 `postMessage` 通讯，所有按钮事件回到扩展执行。

### D5：本地工作区组织

- 根目录可配置：`ojAgent.workspace.root`，默认 `~/oj-agent-workspace`。
- 目录命名：`<platform>/<id>-<slug>-<YYYY-MM-DD>/`，含 `problem.md`（题面）、`meta.json`（元数据 + 样例列表）、`cases/in_<n>.txt`、`cases/out_<n>.txt`、`solution.<ext>`。
- 拉取时若目录已存在则按 `meta.json.updatedAt` 比较远端是否更新，更新仅刷新 `problem.md` 与 `meta.json`，不覆盖 `solution.*`。

### D6：判题执行

- 语言支持：C++（g++/clang++）、Python（python3）、Java（javac+java）、JavaScript（node）。
- 编译命令模板可配置：`ojAgent.lang.cpp.compile`、`ojAgent.lang.cpp.run` 等；默认值见 specs。
- 执行：`child_process.spawn`，stdin 喂 case，stdout/stderr 捕获，wallclock 超时（默认 3s，可配置）。
- 输出归一化：按 OJ 通用规则 `rstrip(line) + trim trailing blank lines`，diff 时高亮第一处差异。
- 编译产物缓存：以源文件 SHA-256 + 编译选项哈希为 key 写入工作区 `.build/` 目录，命中后跳过 compile。

### D7：在线提交与轮询

- 语言映射在适配器内维护静态表（`leetcode-cn` 的 `lang slug ↔ id`，`hdoj` 的 `language` 数字 ID）。
- LeetCode CN 提交后获 `submission_id`，轮询 `submissions/detail/{id}/check/` 直至 `state=SUCCESS`；HDOJ 提交后跳转 `status.php?user=<u>` 抓最新一行。
- 轮询间隔指数退避：1s → 2s → 3s → 5s → 5s …，总超时 60s（可配置）。
- 提交后即时更新状态栏 `OJ-Agent: <Platform> Judging…`，完成后切换为最终状态短文本。

### D8：AI 与平台联动

仅在已有 `ai-assistant` 规范上扩展「上下文来源」：
- 题面 Webview 工具栏挂四个 AI 命令按钮，参数包含当前题目的 `platform/id/slug`。
- 测试结果面板每个失败用例右侧挂「解释错因」，参数包含 `caseIndex`。
- 扩展宿主新增 `ProblemContextProvider` / `TestCaseContextProvider`，由 `context-builder` 在打包前调用以拿到题面 Markdown、代码、失败用例三元组。

**不改动** `ai-assistant` 已有 Requirement，仅以「上下文来源」段补充。

### D9：依赖引入

引入 `iconv-lite`（无原生）、`cheerio`、`markdown-it`、`markdown-it-katex`、`katex`。均为运行时依赖，体积可控。

## Risks / Trade-offs

- **LeetCode CN 反爬升级** → 登录态失效。Mitigation：扩展启动与每次发请求时校验 `csrftoken` 有效性，失效统一弹出「重新登录」引导。
- **HDOJ 页面结构变动** → 样例 / 题面解析失败。Mitigation：解析失败时降级为渲染原始 HTML 并标记「样例解析失败，请手动添加」。
- **GBK 编码处理出错** → 中文乱码。Mitigation：`iconv-lite` 单测覆盖中文样例；HDOJ 提交时同样以 GBK 编码 form body。
- **本地编译器不存在** → 测试失败。Mitigation：首次使用前 `which` 探测并在 Output Channel 打印诊断，给出安装链接。
- **轮询次数过多触发风控** → 账号风险。Mitigation：限速器全局生效；提交流程默认 1s 起步指数退避；用户可配置最小间隔。
- **Webview Cookie 读取受限** → HttpOnly cookie 拿不到。Mitigation：见 D3 方案 A 兜底，引导用户从浏览器复制；M2 再统一升级。

## Migration Plan

M1 是首次落地，无既有用户数据。引入新配置项与新命令；不动 AI 相关 schema。开发期分四个里程碑分支合入：
1. `feat/http-client` + `feat/platform-adapter` 接口（无 UI）。
2. `feat/leetcode-cn-adapter` + `feat/hdoj-adapter`，单测覆盖。
3. `feat/problem-ui`（TreeView + Webview） + `feat/workspace`。
4. `feat/judge-runner` + `feat/submission-runner` + 端到端冒烟。

回滚策略：每个分支独立，未合入 main 之前 AI 路径不受影响；合入后通过功能开关 `ojAgent.platforms.enabled` 控制启停。

## Open Questions

- 提交结果页 Webview 兜底是否在 M1 加入？（PRD 第 9 节为 Codeforces 决策，LeetCode CN / HDOJ 暂无此需求，倾向 M2 再加。） M2 再加
- 工作区目录是否需要在用户首次启动时弹「选择 root 目录」引导？倾向「使用默认，首次创建后在通知里给出『更改』按钮」，待 PM 拍板。 使用默认，首次创建后在通知里给出『更改』按钮

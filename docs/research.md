# OJ 平台接入调研报告

> 调研时间：2026-05-21
> 方法：Chrome DevTools 实地访问各平台、抓取真实接口/页面数据。

本报告记录 6 个 OJ 平台的题目拉取、样例获取、提交三大能力的实地验证结果，作为 `PRD.md` 平台支持矩阵的依据。

---

## 1. LeetCode CN — 官方 GraphQL（最完善）

- **接口**：`POST https://leetcode.cn/graphql`
- **题目详情**：已验证可取完整字段
  - `question(titleSlug)` 返回 `questionId / title / content(HTML) / difficulty / sampleTestCase / exampleTestcases / topicTags / codeSnippets(20种语言模板)`
  - 实测 two-sum：`sampleTestCase = "[2,7,11,15]\n9"`，`exampleTestcases` 含多组样例。
- **题目列表**：`GET https://leetcode.cn/api/problems/algorithms/` 返回 3796 题（`stat_status_pairs`，含题号/标题/难度/提交数）。
  - 注：GraphQL 的 `problemsetQuestionList` 实测报 errors，改用上面的 REST 接口更稳。
- **提交**：GraphQL mutation，需登录 Cookie。
- **结论**：能力最完整，P0。

---

## 2. HDOJ（杭电）— HTML 爬取（最简单稳定）

- **题面**：`GET https://acm.hdu.edu.cn/showproblem.php?pid=1000`
  - 已验证：直接 HTTP 请求即可拿到完整题面，无反爬。
  - 内容在 `panel_content` 区块，含 `Time Limit / Memory Limit / Problem Description / Input / Output / Sample Input / Sample Output`。
  - 实测批量拉取 1000–1005 题标题成功（A+B Problem、Sum Problem、Max Sum 等）。
- **编码**：GB2312/GBK，需 `iconv-lite` 转码。
- **登录**：`POST /userloginex.php?action=login`，字段 `username` + `userpass`，支持 QQ OAuth。
- **提交**：`POST /submit.php`，需登录 Cookie。
- **结论**：结构稳定、无反爬，适合先跑通流程，P0。

---

## 3. Codeforces — 官方 REST API + 页面被 Cloudflare 拦截

- **官方 API**（免认证）：`https://codeforces.com/api/`
  - `problemset.problems` 实测返回 **11200 题**，含 `contestId / index / name / type / tags / rating`，以及 `problemStatistics(solvedCount)`。
  - 支持 `?tags=dp&count=N` 过滤。
  - 难度分布完整（800~3500 各档位题数齐全）。
- **题面正文**：`/contest/{id}/problem/{idx}` 与 `/problemset/problem/{id}/{idx}` **均被 Cloudflare Turnstile 拦截**（实测返回"正在进行安全验证"页面）。
  - 应对：用已登录的 Webview 取 HTML 后解析 `.problem-statement`。
- **提交**：需登录，官方提交接口。
- **结论**：元数据最权威，题面需绕过 Cloudflare，P1。

---

## 4. 洛谷 — 页面内嵌 JSON（无需额外 API）

- **关键发现**：题目数据内嵌在页面 `<script id="lentille-context" type="application/json">` 中。
- **题目列表**：`/problem/list` 页面的 `lentille-context.data.problems`
  - 实测 `count = 16563`，`result[]` 含 `pid / name / difficulty / tags(数字ID) / totalSubmit / totalAccepted / provider`。
- **题目详情**：`/problem/P1001` 页面的 `lentille-context.data.problem`
  - 含 `contenu.content`（Markdown 题面，带 LaTeX）、`background / difficulty / tags`。
- **直接 fetch `?_contentOnly=1` 的 JSON 接口不稳定**（orderBy 参数易报错、跨页 fetch 偶发返回 HTML），优先解析页面内 JSON 更可靠。
- **题面渲染**：Markdown + LaTeX，需 KaTeX。
- **反爬**：Cloudflare + 网易易盾，频繁操作可能触发验证。
- **提交**：需 CSRF Token（页面 `<meta name="csrf-token">`），非官方接口。
- **结论**：数据可靠但需解析页面 JSON，提交有风控，P1。

---

## 5. POJ（北大）— HTML 爬取（服务器慢）

- **题目列表**：`http://poj.org/problemlist`
  - 实测拿到 100 题/页，含 `id / title / ratio(AC/submit) / date`，标题链接为 `problem?id=XXXX`。
- **题面**：`http://poj.org/problem?id=1000`
  - 含 `Time Limit / Memory Limit / Description / Input / Output / Sample Input / Sample Output / Hint / Source`，结构清晰。
- **编码**：GBK。
- **登录**：`POST http://poj.org/login`，字段 `user_id1` + `password1` + 隐藏 `url`（回跳地址）。
- **提交**：`/submit?problem_id=XXXX`（需登录），表单 POST。
- **问题**：服务器响应很慢，多次访问超时（10–30s）。
- **结论**：可支持但体验受网速限制，P2。

---

## 6. 蓝桥云课 — REST API（详情需认证）

- **题目列表**：`GET https://www.lanqiao.cn/api/v2/problems/?limit=N&offset=M`
  - 实测 **count = 8258**，公开可访问，返回 `id / tags / difficulty`。
- **题目详情**：`GET /api/v2/problems/{id}/` **返回 401**（`not_authenticated`，需 JWT）。
- **登录**：跳转 `passport.lanqiao.cn`。
- **特点**：平台主打在线 IDE 评测，本地测评工作流适配成本较高。
- **结论**：列表公开但详情/提交均需认证，且偏在线 IDE，P2。

---

## 7. 共性技术门槛汇总

| 门槛 | 涉及平台 | 应对 |
|---|---|---|
| Cloudflare / 易盾 | Codeforces、洛谷 | Webview 登录获取 Cookie，扩展侧代发请求 |
| GBK 编码 | POJ、HDOJ | `iconv-lite` 转码 |
| 登录态（提交必需） | 全部 | Webview 登录 + SecretStorage 存凭证 |
| LaTeX 渲染 | 洛谷（重度）、LeetCode | KaTeX/MathJax |
| CSRF Token | 洛谷等 | 提交前解析页面 token |
| 非官方接口易变 | 洛谷、LeetCode、POJ、HDOJ | 适配器隔离 + 降级提示 |
| 服务器慢 | POJ | 超时配置 + 重试 |
| 特殊判题 | 多平台部分题 | 仅远程提交，本地标记不可测 |

---

## 8. 推荐接入顺序

1. **M1**：LeetCode CN（GraphQL 最完善）+ HDOJ（最简单），跑通核心闭环。
2. **M2**：Codeforces（官方 API）+ 洛谷（lentille-context 解析）。
3. **M3**：POJ + 蓝桥云课。

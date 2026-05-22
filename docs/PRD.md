# OJ-Agent 产品需求文档（PRD）

> 一个面向多 OJ 平台的解题代理。**核心引擎平台无关，可被 CLI、VSCode 扩展等多种前端复用**，实现题目拉取、本地测试与在线提交的统一工作流。

| 项 | 内容 |
|---|---|
| 文档版本 | v0.2 |
| 创建日期 | 2026-05-21 |
| 更新日期 | 2026-05-21 |
| 状态 | 草稿 |

---

## 1. 背景与目标

### 1.1 背景
算法竞赛与刷题用户需要在多个 OJ 平台（洛谷、LeetCode、Codeforces、POJ、HDOJ、蓝桥云课）之间切换，反复经历"网页读题 → 本地写代码 → 复制粘贴样例 → 手动测试 → 网页提交 → 等待结果"的割裂流程。

### 1.2 目标
提供**一个核心引擎 + 多种前端**的统一解题工作流：

- **核心能力（平台无关）**：题目拉取、样例解析、本地编译运行与对拍、在线提交与判题结果获取、AI 解题辅助。
- **前端形态**：
  - **CLI（`oja`）**：第一公民。终端用户、CI、脚本、其他 Agent 都能集成。
  - **VSCode 扩展**：在编辑器内提供 TreeView、Webview 题面渲染、面板化交互。
  - 未来可扩展到 Cursor / Zed / Neovim / 纯 Web 等其他前端。

最终用户在任意前端都可完成：**拉取**（搜索/浏览题目 → 落地到本地工作区）、**测试**（用样例本地编译运行并自动比对）、**提交**（一键提交到对应 OJ 并查看判题结果）。

### 1.3 非目标（首期不做）
- 不做题解社区、讨论区聚合。
- 不做竞赛实时排名/计时器（后续可扩展）。
- 不做特殊判题（Special Judge）的本地完整模拟，仅做远程提交。
- 不做 IDE 之间的状态同步（每个前端独立维护本地工作区，凭证可通过 core 抽象的 `SecretBackend` 复用系统密钥串实现共享）。

---

## 2. 目标用户

| 用户类型 | 核心诉求 |
|---|---|
| 算法竞赛选手 | 多平台统一刷题、快速本地测试、节省切换成本 |
| 计算机专业学生 | 完成 POJ/HDOJ/洛谷 课程作业题 |
| 求职刷题者 | 在 LeetCode CN 高效刷题 |

---

## 3. 平台支持矩阵（基于调研）

> 调研结论详见 `docs/research.md`。各平台接入难度与能力差异显著。

| 平台 | 题目拉取 | 样例获取 | 提交 | 接入方式 | 优先级 | 备注 |
|------|---------|---------|------|---------|-------|------|
| **LeetCode CN** | ✅ GraphQL | ✅ GraphQL | ✅ GraphQL | 官方 GraphQL（`leetcode.cn/graphql`） | P0 | 最完善，含题面/样例/20种语言模板 |
| **HDOJ** | ✅ HTML | ✅ HTML | ✅ 表单POST | HTML 爬取（GBK编码） | P0 | 结构简单稳定，适合先跑通流程 |
| **Codeforces** | ✅ 官方API | ⚠️ 爬页面 | ✅ 提交接口 | 官方 REST API + webview | P1 | 元数据走API，题面被Cloudflare拦截 |
| **洛谷** | ✅ 内嵌JSON | ✅ 内嵌JSON | ⚠️ 非官方 | 解析 `lentille-context` JSON | P1 | 16563题，含Markdown题面，有易盾验证 |
| **POJ** | ✅ HTML | ✅ HTML | ⚠️ 表单POST | HTML 爬取（GBK编码） | P2 | 服务器慢，体验受限 |
| **蓝桥云课** | ✅ REST API | ❌ 需登录 | ❌ 需登录 | `/api/v2/problems/`（详情需JWT） | P2 | 题目详情需认证，平台偏向在线IDE |

---

## 4. 功能需求

### 4.1 平台账号管理
- **F-1.1** 支持通过前端提供的登录入口（VSCode Webview / CLI 浏览器拉起 / 直接粘贴 Cookie）完成各平台登录，提取 Cookie/Token。
- **F-1.2** 凭证存储经 core 的 `SecretBackend` 抽象：VSCode 端用 `SecretStorage`，CLI 端用系统密钥串（macOS Keychain / Windows Credential Manager / Linux Secret Service via `keytar`），**绝不明文落盘**。
- **F-1.3** 支持多平台账号并存，前端按各自 UX 展示当前各平台登录状态（VSCode 走状态栏 / CLI 走 `oja status`）。
- **F-1.4** 凭证失效时自动检测并提示重新登录。

### 4.2 题目拉取
- **F-2.1** 提供题库浏览能力：VSCode 走侧边栏 TreeView，CLI 走 `oja browse`（TUI 列表）/`oja list`（纯输出），都支持按平台分组、分页/搜索/按难度&标签筛选。
- **F-2.2** 选中题目后拉取题面：VSCode 渲染为只读 Webview（Markdown + KaTeX）；CLI 默认输出渲染后的 Markdown 到终端，可选 `--open` 打开默认浏览器查看本地 HTML。
- **F-2.3** 自动解析样例输入/输出，保存为本地测试用例文件（前端共享同一份 core 解析逻辑）。
- **F-2.4** 自动生成对应语言的代码模板文件（优先用平台返回的 codeSnippet，如 LeetCode）。
- **F-2.5** 本地按 `平台/题号-题目名字-日期/` 组织工作区目录结构（详见 §9.2）；CLI 与 VSCode 共享同一工作区根目录配置。

### 4.3 本地测试
- **F-3.1** 检测并配置本地编译器/解释器（g++、gcc、python、java 等），检测逻辑下沉到 core。
- **F-3.2** 一键编译运行当前代码，喂入样例输入，捕获 stdout（VSCode 通过命令、CLI 通过 `oja test`）。
- **F-3.3** 自动 diff 实际输出与期望输出（忽略行尾空格、末尾换行，与各 OJ 规则一致）。
- **F-3.4** 支持自定义测试用例（用户手动添加 input/output 对到工作区目录）。
- **F-3.5** 测试结果展示：VSCode 走结果面板（diff 高亮），CLI 走 TAP 风格终端输出与可选 JSON。

### 4.4 在线提交
- **F-4.1** 一键提交当前代码到对应平台，自动映射语言 ID（VSCode 命令 / `oja submit`）。
- **F-4.2** 处理各平台提交前置条件（CSRF Token、登录态）。
- **F-4.3** 提交后轮询判题结果：VSCode 走状态栏与面板实时展示，CLI 走流式输出（轮询进度可见）。
- **F-4.4** 编译错误/运行错误时展示平台返回的详细信息。
- **F-4.5** 请求限速避免触发平台风控（可配置最小请求间隔，core 统一限速器）。

### 4.5 配置与设置
- **F-5.1** 工作区根目录、各语言编译命令、提交默认语言可配置。
  - CLI 通过 `~/.config/oj-agent/config.toml`；VSCode 通过 `settings.json`。
  - 两端读取统一通过 core 的 `ConfigBackend` 抽象。
- **F-5.2** 请求间隔、超时时间、代理设置可配置。

### 4.6 AI 助手（内置解题/解释能力）

详见 [openspec/changes/archive/2026-05-21-add-ai-assistant/](../openspec/changes/archive/2026-05-21-add-ai-assistant/) 与对应 specs。要点：

- 在 VSCode 端的题面 Webview 与本地测试结果面板提供 **解释错因 / 生成思路 / 生成题解 / 解释代码** 四类入口；CLI 端通过 `oja explain` / `oja hint` / `oja solve` / `oja review` 提供等价能力。
- 支持以 **Profile** 为单位接入任意 **OpenAI Chat Completions** 或 **Anthropic Messages** 协议端点，含官方 API、Azure OpenAI、DeepSeek、OpenRouter、Ollama OpenAI 兼容、Claude Code Gateway 等。
- API Key 经 core 的 `SecretBackend` 抽象存储（VSCode → `SecretStorage`，CLI → 系统密钥串），与 OJ 凭证命名空间隔离，绝不写入纯文本配置文件。
- 流式输出、可中断、可预览/编辑提示词；默认对发出内容执行脱敏（剥离 `username`/`submissionId`/`Cookie`/`Authorization` 等字段）。
- 速率限制默认 20 req/min，可配置；上下文超长时按优先级（题面 > 失败用例 > 代码 > 样例）截断。

---

## 5. 非功能需求

| 类别 | 要求 |
|---|---|
| 兼容性 | **CLI**：Node ≥ 20，macOS / Windows / Linux。**VSCode 扩展**：VSCode ≥ 1.94（要求支持 ESM 扩展），同等三平台。 |
| 编码处理 | POJ/HDOJ 为 GBK，需用 `iconv-lite` 转码（统一在 core 的 http 层处理） |
| 反爬应对 | Codeforces/洛谷 有 Cloudflare/易盾；前端各自实现登录入口（VSCode Webview / CLI 浏览器拉起），登录态获取后统一交 core 代发请求 |
| 安全 | 凭证仅存系统密钥串（VSCode `SecretStorage` / CLI keytar）；不向第三方上报任何用户数据 |
| 性能 | 题库列表分页加载；本地测试编译产物缓存复用 |
| 健壮性 | 接口变动/失效时降级提示，不崩溃 |
| 可组合性 | CLI 命令默认提供 `--json` 输出格式，便于 shell 管道、CI 与其他 Agent 集成 |

---

## 6. 技术架构

### 6.1 分层与仓库布局

采用 **pnpm Monorepo + 单向依赖** 的分层架构。核心引擎与前端严格解耦：

```
oj-agent/
├── packages/
│   ├── core/        @oj-agent/core   平台无关引擎（零 VSCode 依赖）
│   ├── cli/         @oj-agent/cli    命令行前端（bin: oja）
│   └── vscode/      oj-agent         VSCode 扩展前端
```

**依赖方向**：`cli → core`、`vscode → core`，反向禁止。

```
┌──────────────────────┐    ┌──────────────────────┐
│  @oj-agent/cli       │    │  oj-agent (vscode)   │
│  (oja 命令、TUI)      │    │  (TreeView/Webview)  │
└──────────┬───────────┘    └──────────┬───────────┘
           │                           │
           └─────────────┬─────────────┘
                         ▼
              ┌──────────────────────┐
              │   @oj-agent/core     │
              │  ┌────────────────┐  │
              │  │ platform/      │  │  PlatformAdapter 契约 + 各平台实现
              │  │   adapter.ts   │  │  (leetcode-cn / hdoj / cf / luogu / poj / lq)
              │  ├────────────────┤  │
              │  │ auth/          │  │  凭证管理 + SecretBackend 抽象
              │  ├────────────────┤  │
              │  │ judge/         │  │  本地编译/运行/diff
              │  ├────────────────┤  │
              │  │ http/          │  │  限速、重试、Cookie 注入、GBK 解码
              │  ├────────────────┤  │
              │  │ ai/            │  │  Profile/Runner/Adapter（OpenAI/Anthropic）
              │  └────────────────┘  │
              └──────────────────────┘
```

### 6.2 平台适配器统一接口

```ts
// packages/core/src/platform/adapter.ts
interface PlatformAdapter {
  readonly id: PlatformId;
  login(): Promise<PlatformCredential>;
  listProblems(query: PlatformListQuery): Promise<PlatformProblemSummary[]>;
  getProblem(id: string): Promise<PlatformProblemDetail>;
  submit(id: string, lang: string, code: string): Promise<PlatformSubmissionId>;
  pollResult(sid: PlatformSubmissionId): Promise<PlatformJudgeResult>;
}
```

### 6.3 前端与 core 的契约

core 通过**接口反转**让前端注入平台特定能力，自身保持零外部依赖：

| 抽象（core 定义） | VSCode 实现 | CLI 实现 |
|---|---|---|
| `ConfigBackend` | `vscode.workspace.getConfiguration` | TOML 文件（`~/.config/oj-agent/config.toml`） |
| `SecretBackend` | `vscode.SecretStorage` | `keytar`（系统密钥串） |
| 登录入口 | 内嵌 Webview | 拉起系统浏览器 + 本地回调 / 提示粘贴 Cookie |
| 输出渲染 | Webview Markdown + KaTeX | 终端 ANSI / 可选浏览器打开 HTML |

### 6.4 关键技术决策
- **登录态**：登录入口由前端各自实现，提取的 Cookie/Token 经 `SecretBackend` 抽象落到系统密钥串；扩展/CLI 侧代发请求绕过 Cloudflare 页面拦截。
- **洛谷题面**：直接解析页面 `<script id="lentille-context">` 的 JSON，避免不稳定的非官方 API。
- **Codeforces 题面**：元数据用官方 API；题面正文通过已登录会话取 HTML 后解析。
- **本地判题**：core 的 `judge` 模块统一负责子进程调用编译器、stdin 喂样例、stdout 捕获与归一化 diff，前端只负责呈现结果。
- **模块系统**：core / cli / vscode 三包均为 ESM（`"type": "module"`），VSCode 扩展宿主要求 ≥ 1.94。

---

## 7. 里程碑规划

| 阶段 | 目标 | 平台 | 交付 | 状态 |
|---|---|---|---|---|
| **M0** 架构骨架 | Monorepo 三包拆分（core / cli / vscode）；core 定义 `PlatformAdapter` 等接口契约；CLI `oja` 入口骨架可运行 | — | 可编译运行的分层骨架 + AI 助手能力下沉到 core | ✅ 已完成 |
| **M1** 核心闭环 | 跑通 拉取→本地测试→提交→看结果 全流程 | LeetCode CN + HDOJ | CLI 与 VSCode 双前端均可用原型 | 进行中 |
| **M2** 主流扩展 | 接入官方 API 与页面解析方案 | Codeforces + 洛谷 | 4 平台支持 | 待启动 |
| **M3** 补全与打磨 | 补齐剩余平台，完善配置与体验，处理 vsce 在 Monorepo 下打包 workspace 依赖 | POJ + 蓝桥云课 | 6 平台 + 发布到 VSCode Marketplace + npm | 待启动 |

---

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 非官方接口变动（洛谷/LeetCode/HDOJ/POJ） | 功能失效 | 适配器隔离，单平台失效不影响整体；版本探测 + 降级提示 |
| Cloudflare/易盾验证升级 | 无法访问 | Webview/系统浏览器登录 + 人机验证由用户在前端内完成 |
| 请求过频触发风控/封号 | 用户账号风险 | 强制限速、提交间隔、明确告知用户风险 |
| 特殊判题题目本地无法测 | 测试不准 | 标记此类题，仅支持远程提交，本地测试给出提示 |
| 蓝桥云课题目详情需认证且偏在线IDE | 接入成本高 | 降为 P2，优先保证列表与提交 |
| `vsce package` 在 Monorepo 下对 `workspace:*` 依赖解析有限 | VSCode 扩展发布受阻 | M3 阶段集中解决：方案 A 用 `pnpm deploy` 落地完整 node_modules；方案 B 用 esbuild 把 core 打包进扩展产物 |
| CLI 与 VSCode 凭证存储后端不同 | 跨前端登录态不互通 | 默认各前端独立；后续可探索通过统一的 keytar 命名空间实现共享，但需要解决 VSCode SecretStorage 与 keytar 的双写策略 |

---

## 9. 已确认事项（Resolved Decisions）

1. **首期本地编译运行语言**：C++、Python、Java、JavaScript 四种全部支持，依赖用户本地工具链（g++/clang++、python、JDK、Node.js）。
2. **工作区目录组织**：按平台分目录，二级目录采用 `题号-题目名字-日期` 的格式。
   - 示例：`workspace/codeforces/1900A-Cover-in-Water-2026-05-21/`
3. **Codeforces 提交反馈兜底**：提交完成后自动打开 Webview / 系统浏览器跳转到对应提交记录页面，避免接口反馈不全的场景。
4. **离线缓存**：已拉取的题目（题面、样例、元数据）本地持久化，支持断网查看；远程更新时按需刷新。
5. **核心引擎形态（2026-05-21 决策）**：从"VSCode 插件"调整为"CLI 优先 + VSCode 薄壳"的 Monorepo 分层架构。CLI 是第一公民，VSCode 退化为消费 core 的前端之一。详见 [openspec/changes/add-monorepo-layout/](../openspec/changes/add-monorepo-layout/)。
6. **模块系统**：core / cli / vscode 三包均使用 ESM；VSCode 最低版本提升至 1.94。
7. **凭证存储**：CLI 端用 `keytar`（macOS Keychain / Windows Credential Manager / Linux Secret Service），VSCode 端用 `vscode.SecretStorage`，两端共享 core 的 `SecretBackend` 接口契约。

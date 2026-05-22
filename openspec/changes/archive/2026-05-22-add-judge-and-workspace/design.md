## Context

`add-platform-foundations` 已就位:`HttpClient / CredentialStore / PlatformAdapterRegistry / LeetCodeCnAdapter / HDOJAdapter`。M1 闭环还差三块行动层,CLI 与 VSCode 都需要,但实现细节(目录命名、diff 规则、退避序列)与前端无关,应放在 core。

约束(对齐 PRD §9):
- 工作区目录:`<root>/<platform>/<id>-<slug>-<YYYY-MM-DD>/`。
- 编译产物缓存:命中跳过编译。
- 输出归一化:每行 `rstrip` + 去末尾空行(各 OJ 通用规则)。
- 离线优先:已拉取的题目可在断网下打开题面与样例。
- core 零 VSCode 依赖;`add-monorepo-layout` 已固化此约束。
- Node ≥ 20。

干系人:CLI / VSCode M1 前端;后续 M2/M3 平台接入时复用同一套 workspace / judge / submission 引擎。

## Goals / Non-Goals

**Goals:**
- 提供单一 `WorkspaceManager` 写盘逻辑,使 CLI 的 `oja pull` 与 VSCode `OJ-Agent: 拉取题目` 落盘结果**一字不差**相同(目录、文件、JSON 字段、换行符)。
- 提供单一 `JudgeRunner` 执行流,使两端 `测试` 行为一致(包括 diff 首处差异行/列)。
- 提供单一 `SubmissionRunner` 编排,使两端 `提交` 的退避序列、最小间隔、状态回调一致。
- `LoggerBackend` 让 core 不直接调 `console.log`,VSCode 可路由到 OutputChannel,CLI 路由到 stdout/stderr。
- 全部行为可被纯 mock 单测验证。

**Non-Goals:**
- 不实现 CLI 命令解析与终端渲染(下个 change)。
- 不实现 VSCode TreeView / Webview(下个 change)。
- 不实现 Special Judge 的本地模拟。
- 不引入 watcher / IDE 集成。
- 不实现 `solution.*` 之外的 IDE 模板(如 Makefile)。
- 不实现 git / 版本控制。

## Decisions

### D1:WorkspaceManager 接口

```ts
interface WorkspaceManager {
  resolveProblemDir(platform: PlatformId, id: string, slug: string): string;
  writeProblem(detail: PlatformProblemDetail, options: {
    rootDir: string;
    defaultLang?: 'cpp' | 'python3' | 'java' | 'javascript';
  }): Promise<{ problemDir: string; created: boolean; solutionPath: string }>;
  readMeta(problemDir: string): Promise<WorkspaceMeta | undefined>;
  refresh(detail: PlatformProblemDetail, problemDir: string): Promise<{ refreshed: boolean }>;
  addCustomCase(problemDir: string, input: string, output?: string): Promise<number>;
}
```

- `slug` 经 `slugify`:小写、ASCII、空格/标点 → `-`、最多 60 字符;中文 `pinyin` 不引入(用 `?`-? 不可读) → 改为 `Number(id) + '-' + sha1(title).slice(0,8)` 兜底当 `slug` 全为非 ASCII。
- 日期使用 `new Date().toISOString().slice(0,10)`(YYYY-MM-DD,UTC)。
- `solution.<ext>`:`defaultLang` 为空时仅写 `cpp` 默认;扩展名映射 `cpp→.cpp / python3→.py / java→.java / javascript→.js`。Java 文件名固定为 `Main.java`。
- `meta.json` 字段:`{ platform, id, title, slug, url, difficulty, tags, samples: [{input, output}], timeLimitMs?, memoryLimitKb?, codeSnippets?, fetchedAt, updatedAt }`。

**备选**:使用 `title-pinyin` → 引入 pinyin 库 + 体积 + corner case 多,M1 跳过。

### D2:refresh 策略

- 比较 `local.meta.updatedAt` vs `remote.detail.updatedAt`(若远端无该字段,改比 `fetchedAt` 与远端 statement hash)。
- 远端较新时:覆盖 `problem.md / meta.json` 与全量 `cases/*`;严格保留 `solution.*` 与 `.build/`。
- 用户自定义样例(`cases/in_<n>.txt` 编号大于远端 samples.length)MUST 保留。

### D3:JudgeRunner 实现

```ts
interface JudgeRunOptions {
  problemDir: string;
  lang: 'cpp' | 'python3' | 'java' | 'javascript';
  sourcePath?: string;          // 默认 problemDir/solution.<ext>
  cases?: { input: string; expected?: string; index: number }[]; // 默认全部 meta.samples + custom
  timeoutMs?: number;           // 默认 3000
  compileCmdTemplate?: string;  // 默认从 toolchain.defaults
  runCmdTemplate?: string;
}
interface JudgeRunResult {
  cases: Array<{
    index: number;
    verdict: 'AC' | 'WA' | 'TLE' | 'RE' | 'CE';
    timeMs: number;
    stdout: string;
    stderr: string;
    expected?: string;
    diff?: { firstDiffLine: number; firstDiffCol: number; unifiedDiff: string };
  }>;
  compileError?: string;
}
```

- 编译:`spawn(shell, ['-c', renderTemplate(compileCmd, vars)], { cwd: problemDir })`;占位符 `{src} {out} {dir} {main}`(`{main}` 仅 Java 取 `Main`)。
- 运行:`spawn(shell, ['-c', renderTemplate(runCmd, vars)])`,通过 `child.stdin.write(input + '\n')` 喂样例,`close()` stdin。
- 超时:`wallclock`,到点 `kill 'SIGKILL'`,verdict = `TLE`。
- 归一化:`text.split('\n').map(l => l.replace(/[ \t\r]+$/,''))`,然后去尾部空行;逐行比较,第一处不等记录行号(1-based)与列号(首个不同字符 0-based)。
- 编译产物缓存:`sha256(srcContent + compileCmd) → <problemDir>/.build/<hash>/<artifacts>`;命中即跳过 compile 步骤。
- Java 特例:`out` 与 `dir` 都指向 `.build/<hash>/`,classpath 由 run 模板 `-cp` 注入。
- Compile error 全部写入 `result.compileError` 并 `cases = []`(不跑用例)。

### D4:语言默认命令模板

| lang | compileCmd | runCmd |
|---|---|---|
| cpp | `g++ -O2 -std=c++17 -o {out} {src}` | `{out}` |
| python3 | (空,无需 compile) | `python3 {src}` |
| java | `javac -d {dir} {src}` | `java -cp {dir} {main}` |
| javascript | (空) | `node {src}` |

CLI / VSCode 配置层可覆盖;`renderTemplate` 不允许任意 shell 注入(简单 `${name}` 替换,值经 `shell-quote`)。

### D5:Toolchain 探测

`ToolchainProbe.probe()` 在 PATH 中查 `g++ / clang++ / python3 / python / javac / java / node`,把命中路径与版本(执行 `--version` 截首行)写到 `state.toolchain`。失败 MUST 不抛错,返回 `null`。Probe 结���由 core 持有(LRU 5 分钟),并通过 `LoggerBackend.info` 输出诊断。

### D6:SubmissionRunner 编排

```ts
class SubmissionRunner {
  async run(input: {
    platform: PlatformId;
    problemId: string;
    lang: string;
    code: string;
    minIntervalMs?: number;   // 默认 5000
    pollTimeoutMs?: number;   // 默认 60000
    onProgress?: (state: SubmissionProgress) => void;
  }): Promise<PlatformJudgeResult>;
}
type SubmissionProgress =
  | { stage: 'pre-check' }
  | { stage: 'submitting' }
  | { stage: 'judging'; partial?: PlatformJudgeResult }
  | { stage: 'done'; result: PlatformJudgeResult };
```

- pre-check:`credentialStore.get(platform)` 不存在 → 抛 `AdapterError('AUTH_REQUIRED')`;距上次同平台 submit 小于 `minIntervalMs` → 抛 `AdapterError('RATE_LIMITED', '请稍后重试 (<x>s)')`。
- 提交:`adapter.submit(...)`;失败原样抛。
- 轮询:`adapter.pollResult(sid)` 内部已实现退避;`SubmissionRunner` 包一层 `onProgress` 转发即可。
- 状态历史:`lastSubmitAt: Map<PlatformId, number>` 仅在进程内保留(进程重启重置;5s 风控是软提示)。

### D7:LoggerBackend

```ts
interface LoggerBackend {
  info(scope: string, message: string, extra?: Record<string, unknown>): void;
  warn(scope: string, message: string, extra?: Record<string, unknown>): void;
  error(scope: string, message: string, err?: unknown): void;
}
class NoopLogger implements LoggerBackend { /* 测试默认 */ }
```

core 内任何"原本想 `console.log`"的位置 MUST 改为 `this.logger.info('scope', '...')`。

### D8:文件系统抽象

是否要在 core 引入 `fs` 抽象以便测试 mock?**否**——直接用 `node:fs/promises`,测试中用 `os.tmpdir() + 'oj-agent-test-' + nanoid()` 临时目录,跑完清理。引入抽象层会过度工程化。

### D9:测试策略

- `workspace.test.ts`:临时目录、`writeProblem` 字段断言、`refresh` 不覆盖 solution、custom case 追加。
- `judge.test.ts`:mock spawn(用 `node` 真实跑一个 `console.log("hello")` 脚本)→ 真实编译路径用 `node -e` 模拟 cpp 程序(避免 CI 要装 g++)。归一化、diff ���号、超时 TLE、产物缓存命中。
- `submission.test.ts`:mock adapter 的 submit/pollResult,验证 pre-check 拒绝、最小间隔、onProgress 序列、judging timeout 透传。

## Risks / Trade-offs

- **g++ / javac 不在 PATH** → 测试失败。Mitigation:`ToolchainProbe` 在每次 run 前 lazy 校验所需工具,缺失抛 `AdapterError('PLATFORM_ERROR', '找不到 g++,请安装...')`。
- **临时目录污染** → 测试产物未清理。Mitigation:测试 `after` 钩子 `rm -rf` 临时目录;CI 用 `mktemp -d`。
- **diff 在大输出下慢** → 大测试用例耗时。Mitigation:`unifiedDiff` 限制 100 行内,超过截断并标注。
- **Windows 路径分隔符** → 模板渲染错。Mitigation:`renderTemplate` 用 `path.normalize`,Windows 下 shell 走 `cmd /c`(由 spawn 自动)。
- **Java 文件名约束** → 用户 `solution.java` 含 `class Foo`。Mitigation:文档说明 M1 仅支持 `Main` 类;后续自动识别 `public class`。
- **缓存哈希碰撞** → 极不可能。无 mitigation。
- **退避算法与平台限制不一致** → 风控。Mitigation:`minIntervalMs` 可配置,默认 5s 提示风险。

## Migration Plan

无既有用户数据(M1 首次落地)。开发分两个 PR:

1. `feat/workspace` + `feat/logger`:含单测,独立合入。
2. `feat/judge` + `feat/submission`:依赖第 1 PR。

回滚:仅 core 内代码新增,下游 change 没合入前不暴露给用户。barrel 新增导出向后兼容。

## Open Questions

- 是否在 M1 内支持自动识别 `public class XXX` 让 Java 文件不必叫 `Main.java`?——倾向**否**,文档提示即可,M2 再做。
- 编译产物 `.build/` 是否需要全局 LRU 总大小限制?——倾向**否**,单题目录下自然受限,用户手动清。
- `WorkspaceManager` 是否要暴露事件钩子(如 `onProblemWritten`)给前端做 toast?——倾向**否**,前端自己掌握 `writeProblem` 返回值即可。

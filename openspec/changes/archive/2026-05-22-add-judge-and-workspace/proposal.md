## Why

`add-platform-foundations` 提供了 HTTP / 凭证 / 适配器底层,但 M1 闭环还缺三个上层引擎:**工作区目录组织**、**本地编译运行与对拍**、**在线提交与轮询编排**。这三块是 CLI 与 VSCode 两端共用的"行动层"——前端只负责触发与展示,具体的"在哪里建目录、怎么写题面、怎么编译、怎么对 diff、提交多久 timeout、退避序列"应该在 `@oj-agent/core` 内一次写完,两端复用。如果让 CLI 与 VSCode 各自实现,实现就会分叉(VSCode 已有原 `add-m1-core-loop` 计划的全部逻辑,CLI 又得从 0 重写)。

## What Changes

- **新增** `@oj-agent/core` 内 `workspace/workspace-manager.ts`:`WorkspaceManager.resolveProblemDir(platform, id, slug)` 生成 `<root>/<platform>/<id>-<slug>-<YYYY-MM-DD>/`;`writeProblem(detail, options)` 落盘 `problem.md / meta.json / cases/in_<n>.txt / cases/out_<n>.txt / solution.<ext>`(已存在 solution 不覆盖)。
- **新增** `workspace/sample-cases.ts`:`addCustomCase(problemDir, input, output?)` 追加 `cases/in_<n>.txt`(可选 `out_<n>.txt`),并同步更新 `meta.json.samples`。
- **新增** `workspace/refresh.ts`:基于 `meta.json.updatedAt` 与远端 `detail.updatedAt` 对比;只更新 `problem.md / meta.json / cases/*`,严格保留 `solution.*`。
- **新增** `judge/toolchain.ts`:探测 `g++/clang++/python3/javac/java/node` 路径并缓存;不存在时不抛错,返回 `null` 并在 logger 打印诊断。
- **新增** `judge/runner.ts`:基于 `child_process.spawn` 的编译 + 运行 + stdin 喂样例 + stdout/stderr 捕获 + wallclock 超时 + 输出归一化 diff(`rstrip` 每行 + 去末尾空行)。
- **新增** `judge/cache.ts`:编译产物缓存,key = `sha256(src + compileCmd)`,写入 `<problemDir>/.build/`;命中跳过编译。
- **新增** `submission/runner.ts`:`SubmissionRunner.run({ platform, problemId, lang, code, onProgress })` 编排:登录校验 → 最小间隔检查 → `adapter.submit` → `adapter.pollResult` + 流式回调 → 返回最终 `JudgeResult`。
- **新增** `LoggerBackend` 抽象:与现有 `SecretBackend` 一致的接口反转,前端注入(VSCode `OutputChannel` / CLI `console`)。
- **修改** `@oj-agent/core` barrel:导出 `WorkspaceManager / JudgeRunner / SubmissionRunner / ToolchainProbe / LoggerBackend` 及相关类型。
- **不变** AI 路径;`add-platform-foundations` 落地的 HTTP/Auth/Adapter 不动。

## Capabilities

### New Capabilities

- `problem-workspace`: 工作区目录组织、题面落盘、样例文件、模板生成、离线缓存读写规范。
- `judge-runner`: 本地编译运行、stdin 注入、stdout 捕获、输出归一化、diff 定位、产物缓存规范。
- `submission-runner`: 在线提交编排、最小间隔、提交+轮询的事件回调协议。
- `logger-backend`: `core` 层日志接口反转契约,前端注入具体后端。

### Modified Capabilities

<!-- 不修改已存在 spec。-->

## Impact

- **代码**:在 `packages/core/src/` 新增 `workspace/`、`judge/`、`submission/`、`logger/`;扩展 barrel。
- **依赖**:不新增运行时依赖;`crypto.createHash`、`child_process.spawn`、`node:fs/promises`、`node:path` 均为内置。
- **测试**:新增 mock fs / mock spawn 单测;`judge-runner` 编译路径用临时目录跑真实 `node -e` 做最小集成验证(无需 g++/javac)。
- **下游 change**:`add-cli-m1-commands` / `add-vscode-m1-views` 直接调 `WorkspaceManager.writeProblem`、`JudgeRunner.runAll`、`SubmissionRunner.run`,自身不再实现编译循环。

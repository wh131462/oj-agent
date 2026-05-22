## 1. 准备:目录骨架

- [x] 1.1 在 `packages/core/src/` 新增目录:`workspace/`、`judge/`、`submission/`、`logger/`
- [x] 1.2 在 `packages/core/test/` 新增对应测试目录
- [x] 1.3 不新增运行时依赖;`pnpm install` 不动 lock

## 2. logger-backend

- [x] 2.1 实现 `packages/core/src/logger/logger.ts`:`LoggerBackend` 接口、`NoopLogger` 类
- [x] 2.2 把 `add-platform-foundations` 落地的 core 代码中所有 `console.*` 调用替换为 `logger.<level>(scope, ...)`(http / auth / platform.* scope) — 现有代码无 console 调用,无需替换
- [x] 2.3 在 barrel 导出 `LoggerBackend`、`NoopLogger`
- [x] 2.4 单测 `test/logger.test.ts`:NoopLogger 不抛错;scope 串字面量集合校验脚本

## 3. problem-workspace

- [x] 3.1 实现 `packages/core/src/workspace/slug.ts`:`normalizeSlug(rawSlug, id)`,ASCII 化与回退策略(`'p' + id + '-' + sha1.slice(0,8)`)
- [x] 3.2 实现 `packages/core/src/workspace/workspace-manager.ts`:`resolveProblemDir`、`writeProblem`、`readMeta`、`refresh`、`addCustomCase`
- [x] 3.3 `writeProblem`:`mkdir -p problemDir/cases`,写 `problem.md / meta.json / cases/in_<n>.txt / cases/out_<n>.txt / solution.<ext>`;`solution.<ext>` 已存在不覆盖;返回 `{ created, problemDir, solutionPath }`
- [x] 3.4 `meta.json` 字段固定为 `{ platform, id, title, slug, url, difficulty, tags, samples, timeLimitMs, memoryLimitKb, codeSnippets, fetchedAt, updatedAt, statementHash }`
- [x] 3.5 `refresh`:比较 `updatedAt` / `statementHash`,只覆盖 `problem.md / meta.json / cases/in_1..N / cases/out_1..N`;不动 `solution.*` 与编号 > N 的 case
- [x] 3.6 `addCustomCase`:扫描 `cases/in_*.txt` 取最大编号 + 1,写 `in_<next>.txt`(必填) 与 `out_<next>.txt`(可选 / 空);更新 `meta.json.samples`
- [x] 3.7 `readMeta`:JSON 解析失败时 `logger.warn` 并返回 `undefined`
- [x] 3.8 在 barrel 导出 `WorkspaceManager`、`WorkspaceMeta`
- [x] 3.9 单测 `test/workspace.test.ts`:`os.tmpdir()` 下完整路径断言、目录命名(含中文 slug 回退)、写盘所有字段、`solution.*` 不覆盖、refresh 保留 solution 与自定义 case、addCustomCase 编号递增、readMeta 容错

## 4. judge-runner 工具链

- [x] 4.1 实现 `packages/core/src/judge/toolchain.ts`:`ToolchainProbe.probe()`,`which`-style 路径查找 + `spawn('--version')` 首行,5 分钟 LRU
- [x] 4.2 单测 `test/toolchain.test.ts`:mock PATH,部分缺失返回结构正确;LRU 命中不再 spawn

## 5. judge-runner 执行与 diff

- [x] 5.1 实现 `packages/core/src/judge/template.ts`:`renderTemplate(cmd, { src, out, dir, main })`,`shell-quote` 引号转义(可手写,只处理 `'`/空格 etc)
- [x] 5.2 实现 `packages/core/src/judge/normalize.ts`:`normalize(text)` 每行 rstrip + 去末尾空行;`firstDiff(a, b)` 返回 `{ line, col }`
- [x] 5.3 实现 `packages/core/src/judge/cache.ts`:`computeBuildHash(srcContent, compileCmd)` → sha256;`getBuildDir(problemDir, hash)`,`exists()` 检查
- [x] 5.4 实现 `packages/core/src/judge/runner.ts`:`JudgeRunner.runAll(options)`,组合 toolchain + cache + spawn + normalize + diff
- [x] 5.5 编译阶段:命中缓存跳过;未命中 `mkdir -p .build/<hash>`,`spawn(shell, ['-c', renderedCompileCmd])`,非零退出返回 `{ cases: [], compileError }`
- [x] 5.6 运行阶段:每个 case 起一个子进程,stdin 写入 input,wallclock 超时 SIGKILL → TLE;exit code 非 0 → RE
- [x] 5.7 归一化对比:相等 → AC;不等 → WA,计算 `firstDiffLine/col` 与 unifiedDiff(限 100 行)
- [x] 5.8 在 barrel 导出 `JudgeRunner`、`JudgeRunOptions`、`JudgeRunResult`、`JudgeCaseResult`、`ToolchainProbe`
- [x] 5.9 单测 `test/judge-runner.test.ts`:用 `node` 作为运行/编译产物模拟,覆盖 AC / WA / TLE / RE / 行尾归一化 / firstDiff 行列定位 / template / cache hash

## 6. submission-runner

- [x] 6.1 实现 `packages/core/src/submission/runner.ts`:`SubmissionRunner` 类,构造接受 `{ registry, credentialStore, logger? }`
- [x] 6.2 内部维护 `Map<PlatformId, number>` 记录 `lastSubmitAt`
- [x] 6.3 `run()` 编排:emit `pre-check` → 登录校验 → 间隔校验 → emit `submitting` → `adapter.submit` → emit `judging` → `adapter.pollResult`(透传 onProgress) → emit `done`
- [x] 6.4 `signal` 支持:把 `signal` 一路传给 `httpClient.request`(`adapter` 已支持),触发 abort 时 reject `AbortError`
- [x] 6.5 非 `AdapterError` 异常包装为 `AdapterError('PLATFORM_ERROR', ..., source)`
- [x] 6.6 在 barrel 导出 `SubmissionRunner`、`SubmissionRunInput`、`SubmissionProgress`
- [x] 6.7 单测 `test/submission-runner.test.ts`:mock registry + credentialStore + adapter,覆盖未登录拒绝、最小间隔拒绝、跨平台不互锁、onProgress 序列、JUDGING_TIMEOUT 透传、abort 中止、普通 Error 包装为 PLATFORM_ERROR

## 7. barrel 与验证

- [x] 7.1 更新 `packages/core/src/index.ts`,新增导出全部上述符号;不破坏已有
- [x] 7.2 `pnpm -r build` 通过
- [x] 7.3 `pnpm --filter @oj-agent/core test` 全部新单测通过(111/111)
- [x] 7.4 `grep -r "from 'vscode'" packages/core/src` 仍无结果
- [x] 7.5 `grep -rn "console\\.\\(log\\|warn\\|error\\)" packages/core/src` 无业务代码命中
- [x] 7.6 手动 smoke 留待下游 CLI/VSCode change 端到端验证(本批已通过 JudgeRunner JS 全链路单测覆盖 AC/WA/TLE/RE 路径)
# logger-backend Specification

## Purpose

定义 `@oj-agent/core` 中统一的 `LoggerBackend` 接口与默认 `NoopLogger` 实现,替代 core 代码内所有直接 `console.*` 调用;通过 scope 命名约定支持前端的过滤、着色与归档。

## Requirements

### Requirement: LoggerBackend 接口

`@oj-agent/core` SHALL 提供 `LoggerBackend` 接口,所有 core 内"原本想直接 `console.*`"的位置 MUST 改为 `this.logger.<level>(scope, message, extra?)`。

```ts
interface LoggerBackend {
  info(scope: string, message: string, extra?: Record<string, unknown>): void;
  warn(scope: string, message: string, extra?: Record<string, unknown>): void;
  error(scope: string, message: string, err?: unknown): void;
}
```

#### Scenario: workspace 写盘日志
- **WHEN** `WorkspaceManager.writeProblem` 创建新目录
- **THEN** 调用 `logger.info('workspace', 'created problem dir', { problemDir, platform, id })`

#### Scenario: judge 编译失败
- **WHEN** 编译子进程 stderr 非空
- **THEN** 调用 `logger.warn('judge', 'compile failed', { stderr, lang })`

### Requirement: NoopLogger 默认实现

`@oj-agent/core` SHALL 提供 `NoopLogger implements LoggerBackend`,所有方法均为空操作。core 内构造任何使用 logger 的对象时,若调用方未注入 logger MUST 使用 NoopLogger,MUST NOT 直接调用 `console.*`。

#### Scenario: 默认 NoopLogger
- **WHEN** `new WorkspaceManager({ logger?: undefined })`
- **THEN** 内部使用 NoopLogger,任何 `info/warn/error` 调用都不抛错且不污染 stdout/stderr

### Requirement: scope 命名

logger 调用 MUST 提供 scope 字符串,推荐取值:`http`、`auth`、`platform.leetcode-cn`、`platform.hdoj`、`workspace`、`judge`、`submission`。前端实现可基于 scope 做过滤、着色、归档。

#### Scenario: scope 一致
- **WHEN** 全 core 代码 grep 检查 `logger.info(/warn/error)('` 的第一参数
- **THEN** 全部命中在上述 scope 字面量集合内

## ADDED Requirements

### Requirement: `oja config` 子命令支持 list/unset

`oja config` SHALL 在已有 `get` / `set` 之外补充 `list` 与 `unset` 子命令,基于 `core/config/schema.ts` 校验键路径与类型;未知键 MUST 退出码 2,无效值类型 MUST 退出码 1。

#### Scenario: 列出全部配置
- **WHEN** 执行 `oja config list`
- **THEN** 按 schema 顺序输出全部键值(脱敏 API Key),退出码 0;`--json` 输出结构化 JSON

#### Scenario: 删除单个键
- **WHEN** 执行 `oja config unset workspace.root`
- **THEN** 从 TOML 中移除该键并写回,后续 `oja config get workspace.root` 返回默认值

#### Scenario: 未知键报错
- **WHEN** 执行 `oja config get foo.bar`
- **THEN** stderr 提示 "未知配置键 foo.bar",退出码 2

### Requirement: `oja platforms` 能力矩阵

`oja` SHALL 新增 `oja platforms` 子命令,输出已注册平台的能力矩阵(从 [[platform-adapter]] 的 `capabilities`/`degraded` 读取),支持 `--json`。

#### Scenario: 表格输出
- **WHEN** 执行 `oja platforms`
- **THEN** 以表格形式展示 `platform / listing / detail / submit / poll / 是否降级`,降级平台列出原因

#### Scenario: JSON 输出
- **WHEN** 执行 `oja platforms --json`
- **THEN** 输出 `[{ id, capabilities, degraded? }]` 数组

### Requirement: `oja list` 支持新平台过滤参数

`oja list <platform>` SHALL 支持以下平台特定过滤参数:

- Codeforces:`--tags`、`--rating-min`、`--rating-max`
- 洛谷:`--difficulty`、`--tags`
- POJ:`--page`
- 蓝桥云课:`--limit`、`--offset`

未识别的参数 MUST 提示并退出码 2。

#### Scenario: Codeforces 按标签拉取
- **WHEN** 执行 `oja list codeforces --tags dp,graphs --rating-max 1800`
- **THEN** 调用对应适配器 `listProblems({ tags: ['dp','graphs'], ratingMax: 1800 })`,输出题目列表

#### Scenario: 蓝桥云课分页
- **WHEN** 执行 `oja list lanqiao --limit 50 --offset 100`
- **THEN** 调用 `listProblems({ limit: 50, offset: 100 })`,输出 50 条记录

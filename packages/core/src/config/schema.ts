/**
 * 共享配置 Schema：CLI 与 VSCode 双前端共享同一份配置字段定义。
 *
 * - CLI 通过 `TomlConfigBackend` 持久化到 `~/.config/oj-agent/config.toml`
 * - VSCode 通过 `VSCodeConfigBackend` 桥接到 `vscode.workspace.getConfiguration('ojAgent')`
 *
 * 两端共用本 schema 来：
 * - 校验配置键是否合法（CLI `oja config set` 拒绝未知键）
 * - 应用默认值
 * - 渲染设置面板（VSCode）与 `oja config list`（CLI）的字段顺序与说明
 */

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'array';

export type ConfigFieldValue =
  | string
  | number
  | boolean
  | string[]
  | Record<string, unknown>
  | unknown[];

export interface ConfigFieldSpec {
  /** 字段类型，用于 CLI `set` 时类型转换与校验 */
  readonly type: ConfigFieldType;
  /** 默认值；未设置则为该类型的零值 */
  readonly default?: ConfigFieldValue;
  /** 数值字段最小值（含） */
  readonly min?: number;
  /** 数值字段最大值（含） */
  readonly max?: number;
  /** 给前端渲染用的简短说明 */
  readonly description?: string;
  /** 是否为敏感字段（设置面板/list 输出需要脱敏） */
  readonly sensitive?: boolean;
}

/**
 * 全部配置字段（点路径）。
 *
 * 添加新字段时请保持 CLI / VSCode `package.json contributes.configuration` 一致。
 */
export const CONFIG_SCHEMA: Record<string, ConfigFieldSpec> = {
  // 工作区
  'workspace.root': {
    type: 'string',
    default: '~/oj-agent-workspace',
    description: '题目工作区根目录',
  },

  // 网络
  'http.proxy': {
    type: 'string',
    default: '',
    description: 'HTTP 代理（如 http://127.0.0.1:7890）',
  },
  'http.timeoutMs': {
    type: 'number',
    default: 15_000,
    min: 1000,
    max: 120_000,
    description: 'HTTP 请求默认超时（毫秒）',
  },
  'http.requestIntervalMs': {
    type: 'number',
    default: 0,
    min: 0,
    description: '同平台连续请求最小间隔（毫秒），0 表示不限制',
  },
  'http.rateLimit.leetcode-cn': {
    type: 'number',
    default: 30,
    min: 1,
    description: 'LeetCode CN 每分钟最大请求数',
  },
  'http.rateLimit.hdoj': {
    type: 'number',
    default: 60,
    min: 1,
    description: 'HDOJ 每分钟最大请求数',
  },
  'http.rateLimit.codeforces': {
    type: 'number',
    default: 30,
    min: 1,
    description: 'Codeforces 每分钟最大请求数',
  },
  'http.rateLimit.luogu': {
    type: 'number',
    default: 30,
    min: 1,
    description: '洛谷每分钟最大请求数',
  },
  'http.rateLimit.poj': {
    type: 'number',
    default: 20,
    min: 1,
    description: 'POJ 每分钟最大请求数',
  },
  'http.rateLimit.lanqiao': {
    type: 'number',
    default: 30,
    min: 1,
    description: '蓝桥云课每分钟最大请求数',
  },

  // 编译/运行命令
  'lang.cpp.compile': {
    type: 'string',
    default: 'g++ -O2 -std=c++17 -o {out} {src}',
  },
  'lang.cpp.run': { type: 'string', default: '{out}' },
  'lang.python3.run': { type: 'string', default: 'python3 {src}' },
  'lang.java.compile': { type: 'string', default: 'javac -d {dir} {src}' },
  'lang.java.run': { type: 'string', default: 'java -cp {dir} {main}' },
  'lang.javascript.run': { type: 'string', default: 'node {src}' },

  // 判题
  'judge.timeoutMs': {
    type: 'number',
    default: 3000,
    min: 100,
    max: 60_000,
    description: '本地判题单用例超时（毫秒）',
  },

  // 提交
  'submission.minIntervalMs': {
    type: 'number',
    default: 5000,
    min: 0,
    description: '同平台最小提交间隔（毫秒）',
  },
  'submission.pollTimeoutMs': {
    type: 'number',
    default: 60_000,
    min: 1000,
    description: '提交后轮询判题结果的最大等待时间（毫秒）',
  },

  // UI / 默认值
  'ui.defaultLang': {
    type: 'string',
    default: 'cpp',
    description: '默认编程语言（cpp / python3 / java / javascript）',
  },
  'ui.defaultPlatform': {
    type: 'string',
    default: 'leetcode-cn',
    description: '默认平台',
  },

  // AI（与 SharedConfigStore 同步）
  'ai.profiles': { type: 'array', default: [] },
  'ai.activeProfileId': {
    type: 'string',
    default: '',
    description: '当前激活的 AI Profile ID',
  },
  'ai.rateLimit.perMinute': {
    type: 'number',
    default: 20,
    min: 1,
    description: 'AI 调用每分钟最大次数',
  },
  'ai.privacy.redact': {
    type: 'boolean',
    default: true,
    description: '调用 AI 前自动脱敏请求体（移除 Cookie / Authorization 等）',
  },
};

/** 列出所有已知配置键，按 schema 声明顺序。 */
export function listConfigKeys(): string[] {
  return Object.keys(CONFIG_SCHEMA);
}

/** 取字段定义；未知键返回 undefined。 */
export function getConfigSpec(key: string): ConfigFieldSpec | undefined {
  return CONFIG_SCHEMA[key];
}

export function isKnownConfigKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONFIG_SCHEMA, key);
}

/** 取字段默认值；未知键返回 undefined。 */
export function getConfigDefault(key: string): ConfigFieldValue | undefined {
  return CONFIG_SCHEMA[key]?.default;
}

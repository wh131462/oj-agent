/**
 * 极简命令行参数解析。
 *
 * 支持:
 * - 子命令链:`oja config get workspace.root`(多个位置参数)
 * - `--key value` / `--key=value` / `-k value` / 布尔 `--flag` / `--no-flag`
 * - `--` 终止符:之后的全部归位置参数
 * - 多次出现:flag.array 模式收集为数组(`--tag a --tag b`)
 *
 * 不实现:负数自动识别为非 flag 等高级语义。本 CLI 不需要。
 */

export type FlagType = 'string' | 'number' | 'boolean' | 'string[]';

export interface FlagSpec {
  type: FlagType;
  alias?: string; // 短名,如 'h'
  default?: unknown;
  description?: string;
}

export type FlagsSpec = Record<string, FlagSpec>;

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, unknown>;
  /** 完整原始 argv(不含 node、bin)。 */
  raw: string[];
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function parseArgs(argv: string[], schema: FlagsSpec): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, unknown> = {};
  // 应用默认值
  for (const [k, s] of Object.entries(schema)) {
    if (s.default !== undefined) flags[k] = s.default;
    else if (s.type === 'string[]') flags[k] = [];
    else if (s.type === 'boolean') flags[k] = false;
  }
  // 别名表:alias -> longName
  const aliasMap = new Map<string, string>();
  for (const [k, s] of Object.entries(schema)) {
    if (s.alias) aliasMap.set(s.alias, k);
  }

  let i = 0;
  let acceptFlags = true;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (tok === '--') {
      acceptFlags = false;
      i++;
      continue;
    }
    if (!acceptFlags) {
      positional.push(tok);
      i++;
      continue;
    }
    if (tok.startsWith('--no-')) {
      const name = tok.slice('--no-'.length);
      ensureKnown(name, schema);
      const spec = schema[name]!;
      if (spec.type !== 'boolean') {
        throw new UsageError(`--no-${name} 只能用于布尔 flag`);
      }
      flags[name] = false;
      i++;
      continue;
    }
    if (tok.startsWith('--')) {
      let name: string;
      let value: string | undefined;
      const eq = tok.indexOf('=');
      if (eq >= 0) {
        name = tok.slice(2, eq);
        value = tok.slice(eq + 1);
      } else {
        name = tok.slice(2);
      }
      ensureKnown(name, schema);
      const spec = schema[name]!;
      const consumed = readValue(spec, value, argv, i + 1);
      setFlag(flags, name, spec, consumed.value);
      i = consumed.nextIndex;
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1 && !/^-\d/.test(tok)) {
      const short = tok.slice(1);
      const name = aliasMap.get(short);
      if (!name) {
        throw new UsageError(`未知短名 -${short}`);
      }
      const spec = schema[name]!;
      const consumed = readValue(spec, undefined, argv, i + 1);
      setFlag(flags, name, spec, consumed.value);
      i = consumed.nextIndex;
      continue;
    }
    positional.push(tok);
    i++;
  }

  return { positional, flags, raw: argv };
}

function ensureKnown(name: string, schema: FlagsSpec): void {
  if (!(name in schema)) {
    throw new UsageError(`未知参数 --${name}`);
  }
}

function readValue(
  spec: FlagSpec,
  inlineValue: string | undefined,
  argv: string[],
  pos: number,
): { value: string | boolean; nextIndex: number } {
  if (spec.type === 'boolean') {
    if (inlineValue !== undefined) {
      const v = inlineValue.toLowerCase();
      return {
        value: v === 'true' || v === '1' || v === 'yes',
        nextIndex: pos,
      };
    }
    return { value: true, nextIndex: pos };
  }
  // 非布尔需要一个值
  if (inlineValue !== undefined) return { value: inlineValue, nextIndex: pos };
  const next = argv[pos];
  if (next === undefined || next === '--' || next.startsWith('-')) {
    throw new UsageError(`参数 --${specName(spec)} 需要一个值`);
  }
  return { value: next, nextIndex: pos + 1 };
}

function specName(_spec: FlagSpec): string {
  // 占位:报错信息已含 --,这里不再加 name(调用方可包装)
  return '<flag>';
}

function setFlag(
  flags: Record<string, unknown>,
  name: string,
  spec: FlagSpec,
  raw: string | boolean,
): void {
  switch (spec.type) {
    case 'boolean':
      flags[name] = raw as boolean;
      return;
    case 'string':
      flags[name] = String(raw);
      return;
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new UsageError(`参数 --${name} 必须是数字: ${raw}`);
      flags[name] = n;
      return;
    }
    case 'string[]': {
      const arr = (flags[name] as string[]) ?? [];
      arr.push(String(raw));
      flags[name] = arr;
      return;
    }
  }
}

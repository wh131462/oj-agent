/**
 * Leetcode 函数题的 harness 规范。
 *
 * 平台拉到的 metaData 字符串格式各题略异，这里把它归一化为我们内部稳定的
 * HarnessSpec，再由各语言生成器消费。无须支持的题型（systemdesign / SQL /
 * shell 等）统一返回 { kind: 'unsupported' }，调用方据此决定是否生成 harness。
 */

export type HarnessType =
  | { tag: 'int' }
  | { tag: 'long' }
  | { tag: 'double' }
  | { tag: 'bool' }
  | { tag: 'string' }
  | { tag: 'char' }
  | { tag: 'void' }
  | { tag: 'array'; elem: HarnessType }
  | { tag: 'listnode' }
  | { tag: 'treenode' };

export interface HarnessParam {
  readonly name: string;
  readonly type: HarnessType;
}

export type HarnessSpec =
  | {
      readonly kind: 'function';
      /** 函数名（metaData.name），与 snippet 中 Solution 类的方法名一致。 */
      readonly funcName: string;
      readonly params: readonly HarnessParam[];
      readonly returnType: HarnessType;
    }
  | {
      readonly kind: 'unsupported';
      /** systemdesign / sql / shell / unknown-type 等。 */
      readonly reason: string;
      readonly detail?: string;
    };

/**
 * 把 leetcode 原始 metaData JSON 字符串归一化为 HarnessSpec。
 *
 * 解析失败、含 systemdesign 标记、或含我们不支持的类型，统一返回 unsupported。
 */
export function parseLeetcodeMetaData(metaDataStr: string): HarnessSpec {
  if (!metaDataStr || metaDataStr.trim().length === 0) {
    return { kind: 'unsupported', reason: 'empty-metadata' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(metaDataStr);
  } catch (e) {
    return { kind: 'unsupported', reason: 'invalid-json', detail: String(e) };
  }
  if (!isObject(raw)) {
    return { kind: 'unsupported', reason: 'invalid-json', detail: 'metadata is not an object' };
  }
  if (raw.systemdesign === true || typeof raw.classname === 'string') {
    return { kind: 'unsupported', reason: 'systemdesign' };
  }
  const funcName = raw.name;
  if (typeof funcName !== 'string' || funcName.length === 0) {
    return { kind: 'unsupported', reason: 'no-function-name' };
  }
  const paramsRaw = raw.params;
  if (!Array.isArray(paramsRaw)) {
    return { kind: 'unsupported', reason: 'no-params' };
  }
  const params: HarnessParam[] = [];
  for (const p of paramsRaw) {
    if (!isObject(p) || typeof p.name !== 'string' || typeof p.type !== 'string') {
      return { kind: 'unsupported', reason: 'invalid-param', detail: JSON.stringify(p) };
    }
    const t = parseTypeString(p.type);
    if (!t) return { kind: 'unsupported', reason: 'unknown-type', detail: p.type };
    params.push({ name: p.name, type: t });
  }
  const ret = raw.return;
  if (!isObject(ret) || typeof ret.type !== 'string') {
    return { kind: 'unsupported', reason: 'no-return' };
  }
  const returnType = parseTypeString(ret.type);
  if (!returnType) {
    return { kind: 'unsupported', reason: 'unknown-type', detail: ret.type };
  }
  return { kind: 'function', funcName, params, returnType };
}

/**
 * 解析 leetcode 类型字符串。支持的形式：
 *   integer / long / double / boolean / string / character / void
 *   <X>[]            一维数组
 *   <X>[][]          二维数组（递归）
 *   ListNode / TreeNode
 *   list<integer>    leetcode 偶尔用 list<...> 表示数组
 *
 * 返回 undefined 表示不支持，由上层标记为 unsupported。
 */
export function parseTypeString(s: string): HarnessType | undefined {
  const t = s.trim();
  // 数组后缀 []，逐层剥离
  if (t.endsWith('[]')) {
    const inner = parseTypeString(t.slice(0, -2));
    return inner ? { tag: 'array', elem: inner } : undefined;
  }
  // list<X>
  const m = t.match(/^list<(.+)>$/i);
  if (m) {
    const inner = parseTypeString(m[1]!);
    return inner ? { tag: 'array', elem: inner } : undefined;
  }
  switch (t.toLowerCase()) {
    case 'integer':
    case 'int':
      return { tag: 'int' };
    case 'long':
      return { tag: 'long' };
    case 'double':
    case 'float':
      return { tag: 'double' };
    case 'boolean':
    case 'bool':
      return { tag: 'bool' };
    case 'string':
      return { tag: 'string' };
    case 'character':
    case 'char':
      return { tag: 'char' };
    case 'void':
      return { tag: 'void' };
    case 'listnode':
      return { tag: 'listnode' };
    case 'treenode':
      return { tag: 'treenode' };
    default:
      return undefined;
  }
}

/** 调试用：把 HarnessType 还原成 leetcode 风格类型字符串。 */
export function typeToString(t: HarnessType): string {
  switch (t.tag) {
    case 'array':
      return `${typeToString(t.elem)}[]`;
    case 'int':
      return 'integer';
    case 'long':
      return 'long';
    case 'double':
      return 'double';
    case 'bool':
      return 'boolean';
    case 'string':
      return 'string';
    case 'char':
      return 'character';
    case 'void':
      return 'void';
    case 'listnode':
      return 'ListNode';
    case 'treenode':
      return 'TreeNode';
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 输出归一化与首处差异定位。
 */

export function normalize(text: string): string {
  // 1) 每行右侧 rstrip(空格 / Tab / \r)
  // 2) 去末尾空行
  const lines = text.split('\n').map((l) => l.replace(/[ \t\r]+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

export interface DiffPos {
  /** 1-based 行号 */
  line: number;
  /** 0-based 列号(字符为单位) */
  col: number;
}

/**
 * 找出归一化后两段文本第一处不同位置(行 / 列)。
 * 若完全相等返回 undefined。
 */
export function firstDiff(actual: string, expected: string): DiffPos | undefined {
  const a = normalize(actual).split('\n');
  const e = normalize(expected).split('\n');
  const maxLine = Math.max(a.length, e.length);
  for (let i = 0; i < maxLine; i++) {
    const la = a[i] ?? '';
    const le = e[i] ?? '';
    if (la === le) continue;
    const minLen = Math.min(la.length, le.length);
    let c = 0;
    while (c < minLen && la[c] === le[c]) c++;
    return { line: i + 1, col: c };
  }
  return undefined;
}

/**
 * 简易 unified diff(行级)。仅用于展示,不追求与 GNU diff 完全一致。
 * 超过 100 行时截断并加省略提示。
 */
export function unifiedDiff(actual: string, expected: string, maxLines = 100): string {
  const a = normalize(actual).split('\n');
  const e = normalize(expected).split('\n');
  const lines: string[] = ['--- expected', '+++ actual'];
  // 简化:逐行对比,缺则视为空字符串
  const max = Math.max(a.length, e.length);
  for (let i = 0; i < max; i++) {
    const la = a[i] ?? '';
    const le = e[i] ?? '';
    if (la === le) {
      lines.push(' ' + la);
    } else {
      lines.push('-' + le);
      lines.push('+' + la);
    }
    if (lines.length > maxLines) {
      const rest = max - i - 1;
      if (rest > 0) lines.push(`... ${rest} more lines elided`);
      break;
    }
  }
  return lines.join('\n');
}

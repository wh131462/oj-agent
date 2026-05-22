/**
 * 简易 ANSI 表格。列宽自适应,超长截断。
 */

import { stripAnsi } from './ansi.js';

export interface Column {
  header: string;
  maxWidth?: number;
}

export function renderTable(columns: Column[], rows: string[][]): string {
  const widths = columns.map((c, i) => {
    const headerWidth = visualWidth(c.header);
    const dataMax = rows.reduce((m, r) => Math.max(m, visualWidth(r[i] ?? '')), 0);
    const max = c.maxWidth ?? 100;
    return Math.min(max, Math.max(headerWidth, dataMax));
  });
  const headerLine = columns.map((c, i) => padRight(c.header, widths[i]!)).join('  ');
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  const dataLines = rows.map((r) =>
    columns
      .map((_, i) => padRight(truncate(r[i] ?? '', widths[i]!), widths[i]!))
      .join('  '),
  );
  return [headerLine, sep, ...dataLines].join('\n');
}

function visualWidth(s: string): number {
  // 中文等宽字符算 2 列;其他算 1 列;ANSI 不算
  const plain = stripAnsi(s);
  let w = 0;
  for (const ch of plain) {
    w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  }
  return w;
}

function isWide(cp: number): boolean {
  // 简化判定:CJK Unified Ideographs / Hiragana / Katakana / 全宽
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  );
}

function padRight(s: string, width: number): string {
  const w = visualWidth(s);
  if (w >= width) return s;
  return s + ' '.repeat(width - w);
}

function truncate(s: string, width: number): string {
  if (visualWidth(s) <= width) return s;
  // 简化:逐字符切到 width-1,然后加 …
  let acc = '';
  let w = 0;
  for (const ch of s) {
    const cw = isWide(ch.codePointAt(0)!) ? 2 : 1;
    if (w + cw > width - 1) break;
    acc += ch;
    w += cw;
  }
  return acc + '…';
}

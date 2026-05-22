/**
 * 极简 Markdown -> ANSI 渲染。
 *
 * 支持:#1~#3 标题、列表(- / 1.)、code block(fenced)、行内 `code`、**bold**、*italic*。
 * 不实现:表格、链接图片(原样显示文本)。
 */

import { colorize } from './ansi.js';

export function renderMarkdownTerminal(md: string, ansi: boolean): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const raw of lines) {
    if (raw.startsWith('```')) {
      inFence = !inFence;
      out.push(colorize(ansi, 'gray', raw));
      continue;
    }
    if (inFence) {
      out.push(colorize(ansi, 'cyan', raw));
      continue;
    }
    let line = raw;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const level = m[1]!.length;
      const text = inline(m[2]!, ansi);
      const colored = colorize(ansi, 'bold', text);
      out.push(level === 1 ? '\n' + colored + '\n' : level === 2 ? colored : colored);
      continue;
    }
    if (/^(\s*)([-*])\s+/.test(line)) {
      line = line.replace(/^(\s*)([-*])\s+/, (_, ws, _b) => `${ws}• `);
      out.push(inline(line, ansi));
      continue;
    }
    if (/^(\s*)\d+\.\s+/.test(line)) {
      out.push(inline(line, ansi));
      continue;
    }
    out.push(inline(line, ansi));
  }
  return out.join('\n');
}

function inline(s: string, ansi: boolean): string {
  // 行内 code
  s = s.replace(/`([^`]+)`/g, (_, t: string) => colorize(ansi, 'cyan', t));
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t: string) => colorize(ansi, 'bold', t));
  // italic
  s = s.replace(/\*([^*]+)\*/g, (_, t: string) => colorize(ansi, 'dim', t));
  return s;
}

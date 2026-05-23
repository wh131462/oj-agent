/**
 * Codeforces 题面 HTML 解析。
 *
 * Codeforces 题面页面结构：
 *   .problem-statement
 *     .header
 *       .title
 *       .time-limit (.property-title + 文本)
 *       .memory-limit
 *       .input-file / .output-file
 *     div (顶部描述段落，没有专门 class)
 *     .input-specification > .section-title 'Input'
 *     .output-specification > .section-title 'Output'
 *     .sample-tests
 *       .sample-test
 *         .input  > pre
 *         .output > pre
 *     .note (optional)
 */

import { AdapterError } from '../errors.js';
import { loadCheerio } from '../hdoj/cheerio-loader.js';
import type { PlatformProblemDetail, PlatformSampleCase } from '../adapter.js';

export interface CodeforcesProblemHtml {
  /** 题面 Markdown */
  statement: string;
  /** 样例 input/output 列表 */
  samples: PlatformSampleCase[];
  /** 时间限制（毫秒） */
  timeLimitMs?: number;
  /** 内存限制（KB） */
  memoryLimitKb?: number;
  /** 标题 */
  title: string;
}

export async function parseCodeforcesProblem(html: string): Promise<CodeforcesProblemHtml> {
  const cheerio = await loadCheerio();
  const $ = cheerio.load(html);
  const stmt = $('.problem-statement').first();
  if (stmt.length === 0) {
    throw new AdapterError(
      'PARSE_ERROR',
      'Codeforces 题面解析失败：未找到 .problem-statement 节点',
      false,
    );
  }

  const title = stmt.find('.header .title').first().text().trim();
  const timeLimitText = stmt.find('.header .time-limit').first().text();
  const memoryLimitText = stmt.find('.header .memory-limit').first().text();
  const timeLimitMs = parseTimeLimit(timeLimitText);
  const memoryLimitKb = parseMemoryLimit(memoryLimitText);

  // 题面正文：去掉 header 与 sample-tests，剩下的视为正文
  const sections: string[] = [];
  const header = stmt.find('.header').first();
  // 顶部 description（直接子 div，紧跟 header 之后）
  let next = header.next();
  while (next.length && !next.hasClass('input-specification')) {
    sections.push(htmlToMarkdown($, next));
    next = next.next();
  }

  const inputSpec = stmt.find('.input-specification').first();
  if (inputSpec.length) {
    sections.push('## Input\n\n' + htmlToMarkdown($, inputSpec, true));
  }
  const outputSpec = stmt.find('.output-specification').first();
  if (outputSpec.length) {
    sections.push('## Output\n\n' + htmlToMarkdown($, outputSpec, true));
  }
  const note = stmt.find('.note').first();
  if (note.length) {
    sections.push('## Note\n\n' + htmlToMarkdown($, note, true));
  }

  const statement = sections
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n\n');

  // 样例
  const samples: PlatformSampleCase[] = [];
  stmt.find('.sample-tests .sample-test').each((_, el) => {
    const $el = $(el);
    const input = $el.find('.input pre').first().text();
    const output = $el.find('.output pre').first().text();
    samples.push({
      input: normalizePre(input),
      output: normalizePre(output),
    });
  });

  return {
    statement,
    samples,
    title,
    ...(timeLimitMs !== undefined ? { timeLimitMs } : {}),
    ...(memoryLimitKb !== undefined ? { memoryLimitKb } : {}),
  };
}

function parseTimeLimit(text: string): number | undefined {
  // "time limit per test1 second" / "2 seconds" / "500 milliseconds"
  const m = text.match(/([\d.]+)\s*(seconds?|ms|milliseconds?)/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  if (Number.isNaN(v)) return undefined;
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith('ms') || unit.startsWith('millisecond')) return Math.round(v);
  return Math.round(v * 1000);
}

function parseMemoryLimit(text: string): number | undefined {
  // "memory limit per test256 megabytes" / "512 mb" / "1024 kb"
  const m = text.match(/([\d.]+)\s*(megabytes?|mb|kilobytes?|kb|gb)/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  if (Number.isNaN(v)) return undefined;
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith('k')) return Math.round(v);
  if (unit === 'gb') return Math.round(v * 1024 * 1024);
  return Math.round(v * 1024);
}

function normalizePre(s: string): string {
  // Codeforces 在 <pre> 中常用 \n;去掉首尾空行
  return s.replace(/^\s*\n/, '').replace(/\s+$/, '');
}

/**
 * 极简 HTML→Markdown 转换。Codeforces 题面主要含：
 * - <p> 段落
 * - <ul>/<ol>/<li>
 * - <code>/<pre>
 * - <span class="tex-span"> 形式的 LaTeX（保留 $...$）
 * - <img>（保留 alt 文本与 src）
 */
function htmlToMarkdown(
  $: ReturnType<Awaited<ReturnType<typeof loadCheerio>>['load']>,
  node: ReturnType<typeof $>,
  skipFirstSectionTitle = false,
): string {
  const out: string[] = [];
  node.contents().each((_, el) => {
    out.push(renderNode($, $(el), skipFirstSectionTitle));
  });
  return out.join('').trim();
}

function renderNode(
  $: ReturnType<Awaited<ReturnType<typeof loadCheerio>>['load']>,
  el: ReturnType<typeof $>,
  skipSectionTitle: boolean,
): string {
  if (el.length === 0) return '';
  const node = el.get(0)!;
  if (node.type === 'text') {
    return (node as { data: string }).data;
  }
  if (node.type !== 'tag') return '';
  const tag = (node as { tagName: string }).tagName.toLowerCase();
  switch (tag) {
    case 'p':
      return '\n\n' + childrenMd($, el) + '\n\n';
    case 'br':
      return '\n';
    case 'b':
    case 'strong':
      return '**' + childrenMd($, el) + '**';
    case 'i':
    case 'em':
      return '*' + childrenMd($, el) + '*';
    case 'code':
      return '`' + el.text() + '`';
    case 'pre':
      return '\n\n```\n' + el.text() + '\n```\n\n';
    case 'ul': {
      const items: string[] = [];
      el.children('li').each((_, li) => {
        items.push('- ' + childrenMd($, $(li)).trim());
      });
      return '\n' + items.join('\n') + '\n';
    }
    case 'ol': {
      const items: string[] = [];
      el.children('li').each((i, li) => {
        items.push(`${i + 1}. ` + childrenMd($, $(li)).trim());
      });
      return '\n' + items.join('\n') + '\n';
    }
    case 'span': {
      // tex-span 包裹 LaTeX，外层是 $$...$$ 格式（CF 习惯）
      const cls = el.attr('class') ?? '';
      if (cls.includes('tex-span') || cls.includes('tex-formula')) {
        const txt = el.text().trim();
        if (txt.startsWith('$') && txt.endsWith('$')) return txt;
        return '$' + txt + '$';
      }
      return childrenMd($, el);
    }
    case 'div': {
      const cls = el.attr('class') ?? '';
      if (skipSectionTitle && cls.includes('section-title')) return '';
      return '\n' + childrenMd($, el) + '\n';
    }
    case 'img': {
      const src = el.attr('src') ?? '';
      const alt = el.attr('alt') ?? '';
      return `![${alt}](${src})`;
    }
    case 'a': {
      const href = el.attr('href') ?? '';
      return `[${childrenMd($, el)}](${href})`;
    }
    default:
      return childrenMd($, el);
  }
}

function childrenMd(
  $: ReturnType<Awaited<ReturnType<typeof loadCheerio>>['load']>,
  el: ReturnType<typeof $>,
): string {
  const out: string[] = [];
  el.contents().each((_, c) => {
    out.push(renderNode($, $(c), false));
  });
  return out.join('');
}

export function buildProblemDetail(
  id: string,
  contestId: number,
  index: string,
  parsed: CodeforcesProblemHtml,
  difficulty?: string,
  tags?: string[],
): PlatformProblemDetail {
  return {
    platform: 'codeforces',
    id,
    title: parsed.title || `${contestId}${index}`,
    statement: parsed.statement,
    samples: parsed.samples,
    url: `https://codeforces.com/contest/${contestId}/problem/${index}`,
    ...(difficulty !== undefined ? { difficulty } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(parsed.timeLimitMs !== undefined ? { timeLimitMs: parsed.timeLimitMs } : {}),
    ...(parsed.memoryLimitKb !== undefined ? { memoryLimitKb: parsed.memoryLimitKb } : {}),
  };
}
